export const READSET = [
  'AGENTS.md',
  'docs/production/AUTHORITY.md',
  'skills/game-production/SKILL.md',
  '.gameprod/project.json',
  '.gameprod/decisions.json',
  '.gameprod/requirements.json',
  '.gameprod/state.json',
  '.gameprod/backlog.json',
  '.gameprod/roadmap.json',
  '.gameprod/research.json',
  'docs/MANUAL_TESTS.ru.md',
  'CHANGELOG.ru.md'
];
export function publicInstall(r) {
  if (!r) return null;
  return Object.fromEntries(
    [
      'version',
      'versionCode',
      'sourceCommit',
      'installedAt',
      'readyMarker',
      'originalSha256',
      'installedSha256'
    ]
      .filter((k) => r[k] !== undefined)
      .map((k) => [k, r[k]])
  );
}
export function nextCommand({ dirty, pr, candidate, qualification, head }) {
  if (dirty)
    return {
      command: 'audit',
      why: 'Сначала сохранить и проверить текущие изменения; не делать reset/clone поверх работы.'
    };
  if (pr?.state === 'OPEN') {
    if (candidate?.head !== head)
      return { command: 'candidate', why: 'Получить APK для текущего HEAD после успешного CI.' };
    if (qualification?.status !== 'passed' || qualification?.candidateHead !== head)
      return {
        command: 'qualify --physical',
        why: 'Новая квалификация текущего APK, а не старые радиоиспытания.'
      };
    return {
      command: 'integrate ' + pr.number,
      why: pr.isDraft
        ? 'После проверок перевести этот же PR из draft в ready.'
        : 'Объединить проверенный HEAD только в dev.'
    };
  }
  return {
    command: 'resume',
    why: 'Проверить живые Git/CI/device-факты и выбрать первую незакрытую задачу.'
  };
}
export function renderHandoff(h) {
  return [
    '# Multimental — переход в новый чат',
    '',
    'Снимок на ' + h.observedAt + '. Сначала перепроверить инструменты; не начинать проект заново.',
    '',
    '## Разрешённая область',
    '',
    'Репозиторий: **neurofoxpro/multimental**. Компьютер: **VENEL-SENDRIK**. Remote Desktop ID: 418c9e1f-0c2b-4b28-95a3-722812a83408. Git/gh: venelsendrik. Папка: %USERPROFILE%/MultimentalWork/repo. Другие компьютеры и репозитории запрещены. Main/stable/Google Play — отдельное согласование.',
    '',
    '## Точка остановки',
    '',
    'Ветка: ' +
      h.branch +
      '; HEAD: ' +
      h.head +
      '; локальные изменения: ' +
      (h.dirty ? 'есть, сохранить' : 'нет по снимку') +
      '.',
    h.pr
      ? 'PR #' +
        h.pr.number +
        ', база ' +
        h.pr.baseRefName +
        ', ' +
        h.pr.state +
        ', draft ' +
        h.pr.isDraft +
        '.'
      : 'Открытый PR не подтверждён.',
    'Последняя наблюдавшаяся установка: ' +
      (h.installed?.version || 'не подтверждена') +
      '; исходный коммит ' +
      (h.installed?.sourceCommit || 'неизвестен') +
      '. Кандидат и установленный dev-релиз — разные факты.',
    '',
    'Следующая предварительная команда: scripts/chat.cmd ' + h.next.command + '. ' + h.next.why,
    '',
    '## Порядок продолжения',
    '',
    '1. Проверить list_devices и выбрать только указанный ID, затем hostname/origin.',
    '2. Прочитать readset ниже. Выполнить scripts/chat.cmd resume и scripts/chat.cmd handoff.',
    '3. Пользоваться audit, candidate, qualify, cycle, resume-cycle, research, readiness; не повторять десятки Git/ADB-команд вручную.',
    '4. На тестах не менять source, не удалять живые locks. Failed/stale не означает passed.',
    '5. Не повторять настроенные Git/gh/ADB/эмуляторы/подпись. Не выгружать local-конфиги, ключи, serial, MAC/IP или полные логи.',
    '6. Явный отказ защитного инструмента не обходить другим аккаунтом или компьютером; записать точную границу операции.',
    '7. После работы сохранить результаты и новый handoff в GitHub; отчёт пользователю содержит только проверенные версии.',
    '',
    '## Обязательный readset',
    '',
    ...READSET.map((x) => '- ' + x),
    '',
    '## Полнота контекста',
    '',
    'Сохранены доступные решения концепции, платформ, правил, интерфейса, экономики, сети, производства и корректировок. Это не полный дословный экспорт скрытых/пропущенных сообщений. Старые a/b/c без текста вариантов нельзя расшифровывать выдумкой. CHAT_RECOVERY.ru.md и requirements.json содержат восстановленные утверждения с источниками; поздняя явная правка имеет приоритет.',
    '',
    '## Требования, которые нельзя забыть',
    '',
    'Поле 3x3; победа за пять клеток или пустые руку и колоду; одно действие за ход; пять стихий без врождённого круга преимуществ; полная мультивселенная для всех. Android первым, портретный; Web/ПК альбомный позже; RU/EN. Офлайн без обязательного интернета и гринда. Пак — пять карт; пыль и валюта лобби отделены от боевых монет; ещё два боевых ресурса позже. Центральные свойства отложены владельцем.',
    '',
    '## Очередь до беты',
    '',
    ...h.remaining.map(
      (x) => '- ' + x.id + ' · ' + x.version + ' · ' + x.text + ' [' + x.status + ']'
    ),
    '',
    '## Действительно ручное',
    '',
    ...h.manual.map((x) => '- ' + x.text),
    '',
    'Нереализованный код не переносить в ручную приёмку ради названия beta. Roadmap: docs/ROADMAP.ru.md; русский changelog создаётся из changes/fragments.',
    ''
  ].join('\n');
}
