import { createHash } from 'node:crypto';
export const REPO = 'neurofoxpro/multimental';
export const PACKAGE = 'pro.neurofox.multimental.dev';
export const hash = (b) => createHash('sha256').update(b).digest('hex');
const SHA = /^[a-f0-9]{40}$/,
  HASH = /^[a-f0-9]{64}$/;
export function reviewOptions(args) {
  const [mode = 'ready', ...rest] = args;
  if (!['ready', 'resume', 'status'].includes(mode))
    throw Error(
      'review ready [--commit SHA] [--target emulator-A|emulator-B|auto] | resume | status'
    );
  if (mode !== 'ready') {
    if (rest.length) throw Error('Resume/status use the recorded request');
    return { mode };
  }
  const values = {};
  for (let i = 0; i < rest.length; i += 2) {
    const k = rest[i],
      v = rest[i + 1];
    if (!['--commit', '--target'].includes(k) || Object.hasOwn(values, k) || !v)
      throw Error('Invalid review argument');
    values[k] = v;
  }
  const commit = values['--commit'] || null,
    target = values['--target'] || 'auto';
  if ((commit && !SHA.test(commit)) || !['auto', 'emulator-A', 'emulator-B'].includes(target))
    throw Error('Review is computer-only and pins a complete SHA');
  return { mode, commit, target };
}
export function checkedRelease(release, commit) {
  if (
    !release ||
    !Number.isSafeInteger(release.id) ||
    release.id < 1 ||
    !SHA.test(commit || '') ||
    release.target_commitish !== commit ||
    release.draft !== false ||
    release.prerelease !== true ||
    !/^v\d+\.\d+\.\d+-alpha\.\d+\.\d+$/.test(release.tag_name || '') ||
    !Array.isArray(release.assets)
  )
    throw Error('Exact published development release required');
  if (release.html_url !== 'https://github.com/' + REPO + '/releases/tag/' + release.tag_name)
    throw Error('Release URL mismatch');
  return release;
}
export function checkedPcEvidence(lab, suite, release, manifest, readHash) {
  checkedRelease(release, manifest.commit);
  if (
    lab?.status !== 'passed' ||
    lab.reviewOnly !== true ||
    !['emulator-A', 'emulator-B'].includes(lab.target) ||
    lab.release !== release.tag_name ||
    lab.installation?.sourceCommit !== manifest.commit ||
    lab.installation.originalSha256 !== manifest.sha256 ||
    !HASH.test(lab.testerSourceHash || '') ||
    lab.suite?.runId !== suite?.runId
  )
    throw Error('Computer test must match this release and original APK');
  const modes = ['close', 'launch', 'jni', 'tutorial', 'ui', 'inspector', 'collection', 'restore'];
  if (
    suite.status !== 'passed' ||
    suite.target !== lab.target ||
    suite.suite !== 'handoff' ||
    suite.repository !== REPO ||
    suite.toolDigest !== lab.testerSourceHash ||
    suite.toolDigestAfter !== suite.toolDigest ||
    JSON.stringify(suite.installation) !== JSON.stringify(lab.installation) ||
    JSON.stringify(suite.installationAfter) !== JSON.stringify(suite.installation) ||
    JSON.stringify(suite.modes) !== JSON.stringify(modes) ||
    suite.results?.length !== modes.length
  )
    throw Error('Complete unchanged computer handoff suite required');
  const finished = Date.parse(suite.finishedAt),
    started = Date.parse(suite.observedAt);
  if (!Number.isFinite(finished) || !Number.isFinite(started) || finished < started)
    throw Error('Invalid test time');
  for (let i = 0; i < modes.length; i++) {
    const r = suite.results[i];
    if (
      r.mode !== modes[i] ||
      r.receipt !== 'device-' + lab.target + '-' + r.mode + '-' + suite.runId + '.json' ||
      r.status !== 'passed' ||
      r.exitCode !== 0 ||
      !HASH.test(r.receiptSha256 || '') ||
      !new RegExp('^device-' + lab.target + '-' + r.mode + '-[a-f0-9-]{36}\\.json$').test(
        r.receipt || ''
      ) ||
      readHash('.gameprod/evidence/' + r.receipt) !== r.receiptSha256
    )
      throw Error('Missing or altered per-step test evidence');
  }
  return {
    target: lab.target,
    labRunId: lab.runId,
    suiteRunId: suite.runId,
    testerSourceHash: suite.toolDigest,
    finishedAt: suite.finishedAt,
    originalSha256: manifest.sha256,
    testedInstalledSha256: suite.installation.installedSha256,
    steps: suite.results.map((r) => ({
      mode: r.mode,
      status: r.status,
      receiptSha256: r.receiptSha256
    })),
    launcher: 'not_a_gate_for_computer_review',
    humanAcceptance: 'pending'
  };
}
export function manualNames(manifest, certificate) {
  if (
    !SHA.test(manifest?.commit || '') ||
    !/^\d+\.\d+\.\d+-alpha\.\d+\.\d+$/.test(manifest.version || '') ||
    !HASH.test(certificate || '')
  )
    throw Error('Manual asset identity invalid');
  return {
    apk:
      'multimental-' +
      manifest.version +
      '-' +
      manifest.commit.slice(0, 7) +
      '-manual-' +
      certificate.slice(0, 12) +
      '.apk'
  };
}
export function assetState(assets, expected) {
  if (
    !Array.isArray(assets) ||
    !Number.isSafeInteger(expected.size) ||
    expected.size < 1 ||
    !HASH.test(expected.sha256 || '')
  )
    throw Error('Invalid publication expectation');
  const found = assets.filter((a) => a.name === expected.name);
  if (found.length > 1) throw Error('Duplicate release asset');
  if (!found.length) return null;
  const a = found[0];
  if (
    a.state !== 'uploaded' ||
    a.size !== expected.size ||
    a.digest !== 'sha256:' + expected.sha256 ||
    !Number.isSafeInteger(a.id)
  )
    throw Error('Existing release asset differs; preserve it');
  return a;
}
export async function publishAsset(a, expected) {
  const existing = assetState(await a.list(), expected);
  if (existing) return { asset: existing, reused: true };
  const prior = await a.load();
  if (prior?.attempted)
    throw Error(
      'Earlier upload is unconfirmed; readback found no exact asset, do not retry blindly'
    );
  if (await a.immutable()) throw Error('Immutable release cannot receive supplemental assets');
  await a.save({ attempted: true, expected });
  let problem = null;
  try {
    await a.upload();
  } catch (e) {
    problem = e;
  }
  const actual = assetState(await a.list(), expected);
  if (!actual) throw problem || Error('Upload did not produce the expected immutable bytes');
  await a.save({ attempted: true, expected, assetId: actual.id, confirmed: true });
  return { asset: actual, reused: false, recoveredReply: !!problem };
}
export function packetMarkdown(p) {
  const lines = [
    '# Multimental ' + p.version + ' — ручная проверка разработчиком',
    '',
    '**APK:** [Скачать проверяемую сборку](' + p.links.apk + ')',
    '**Релиз:** ' + p.links.release,
    '**Исходники:** ' + p.links.source,
    '',
    'Подключение телефона к компьютеру, USB и ADB не нужны. Ссылку можно открыть через мобильный интернет. При полностью отсутствующем интернете сначала сохраните APK на устройстве или перенесите файл доступным способом.',
    '',
    '## Установка без потери сохранений',
    '',
    'Откройте APK на телефоне и подтвердите штатную установку/обновление. Разрешение установки выдавайте только выбранному файловому менеджеру или браузеру. Не отключайте защиту устройства. Если Android сообщает о конфликте подписи или понижении версии — остановитесь, не удаляйте приложение и его данные.',
    '',
    'Вариант manual подписан существующим постоянным dev-сертификатом проекта, а не временным CI-ключом. Подходит для обновления ранее установленной версии только с этим же сертификатом.',
    '',
    'APK SHA-256: ' + p.manualApk.sha256,
    'Сертификат SHA-256: ' + p.manualApk.certificateSha256,
    '',
    '## Что уже проверено на компьютере',
    '',
    'Android-эмулятор ' +
      p.computer.target +
      ', полный сценарий запуска/JNI/обучения/UI/карточки/коллекции/обычного перезапуска. Проверено соответствие исходной APK и точных журналов. Подпись эмулятора отдельная; содержимое APK manual после смены подписи побайтно сверено по всем полезным ZIP-записям с этой же исходной сборкой. Сам телефон этим не считается проверенным.',
    '',
    '## Проверить вручную · 5–10 минут',
    '',
    '1. Запустить с домашнего экрана. Убедиться, что версия ' +
      p.version +
      ' и сохранённые колоды остались на месте.',
    '2. Начать партию выбранной колодой, выбрать/поставить карту, повернуть направление, осмотреть поле и завершить ход. Отметить лишние нажатия и непонятные действия.',
    '3. Открыть карточку и коллекцию, сменить язык RU/EN. Проверить мелкий текст, обрезания, попадание пальцем и возврат назад.',
    '4. Открыть создание/вход в комнату и отменить. Настоящую дуэль проверять отдельно при наличии второго устройства; не выдавать просмотр экрана за сетевой тест.',
    '5. Полностью закрыть и снова открыть приложение. Проверить сохранения и значок. Снимок или запись проблемного действия приложить к отзыву.',
    '',
    '## Вернуть результат',
    '',
    '[Открыть готовый отчёт в GitHub](' + p.links.feedback + ')',
    '',
    'Версия: ' + p.version,
    'Commit: ' + p.sourceCommit,
    'Устройство и Android:',
    'Что проверено:',
    'Результат: пройдено / проблема / не проверено',
    'Шаги воспроизведения:',
    'Ожидалось:',
    'Получилось:',
    'Скриншот/видео:',
    '',
    'До получения этого отзыва ручная приёмка остаётся pending. Ключи подписи, личный профиль и ADB-идентификаторы в пакет не включены.',
    ''
  ];
  return lines.join('\n');
}
