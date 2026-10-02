import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJSON, writeJSON, findRoot } from '../skills/game-production/scripts/lib.mjs';
export function readiness(data) {
  if (data?.schemaVersion !== 1 || !Array.isArray(data.requirements) || !data.requirements.length)
    throw Error('Requirements registry required');
  const seen = new Set(),
    manualKinds = new Set(['product', 'subjective', 'physical_consent', 'release_approval']);
  for (const r of data.requirements) {
    if (
      !/^[A-Z]+-\d+$/.test(r.id) ||
      seen.has(r.id) ||
      !r.text ||
      !r.source ||
      !Array.isArray(r.evidence) ||
      typeof r.requiredForBeta !== 'boolean'
    )
      throw Error('Invalid requirement');
    seen.add(r.id);
    if (!['planned', 'implemented', 'verified', 'manual'].includes(r.status))
      throw Error('Unknown requirement state');
    if (r.status === 'verified' && !r.evidence.length)
      throw Error('Verified requirement needs evidence');
    if (r.status === 'manual' && !manualKinds.has(r.kind))
      throw Error('Unimplemented code cannot be classified as manual acceptance');
  }
  const required = data.requirements.filter((x) => x.requiredForBeta),
    automatic = required.filter((x) => x.status !== 'manual'),
    remaining = automatic.filter((x) => x.status !== 'verified');
  return {
    schemaVersion: 1,
    status: remaining.length ? 'not_beta_ready' : 'automatic_beta_scope_complete',
    total: data.requirements.length,
    automaticallyVerified: automatic.filter((x) => x.status === 'verified').length,
    remaining: remaining.map((x) => ({
      id: x.id,
      text: x.text,
      status: x.status,
      version: x.version
    })),
    manual: required
      .filter((x) => x.status === 'manual')
      .map((x) => ({ id: x.id, text: x.text, kind: x.kind }))
  };
}
export function render(report) {
  return (
    '# Готовность к бете — контроль требований\n\nСтатус: **' +
    (report.status === 'not_beta_ready'
      ? 'есть невыполненные автоматизируемые требования'
      : 'автоматизируемая часть выполнена') +
    '**. Ручная приёмка не используется для сокрытия отсутствующей реализации.\n\n## Сначала реализовать и проверить\n\n' +
    report.remaining
      .map((x) => '- ' + x.id + ' · ' + x.version + ' · ' + x.text + ' [' + x.status + ']')
      .join('\n') +
    '\n\n## Действительно ручные пункты\n\n' +
    report.manual.map((x) => '- ' + x.id + ' · ' + x.text).join('\n') +
    '\n\nПорядок этапов: roadmap; источники требований: .gameprod/requirements.json. Статус verified относится к указанным доказательствам, а не к автоматически утверждённой свежести всех прошлых версий. После изменения реализации соответствующий gate повторяется.\n'
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = findRoot(),
    report = readiness(readJSON(path.join(root, '.gameprod/requirements.json')));
  for (const req of readJSON(path.join(root, '.gameprod/requirements.json')).requirements)
    for (const ref of req.evidence)
      if (!fs.existsSync(path.join(root, ref))) throw Error('Missing requirement evidence ' + ref);
  const cmd = process.argv[2] || 'plan';
  if (cmd === 'render')
    fs.writeFileSync(path.join(root, 'docs/BETA_READINESS.ru.md'), render(report));
  else if (cmd === 'check') console.log('REQUIREMENTS_SCHEMA_PASS count=' + report.total);
  else if (cmd === 'gate') {
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'automatic_beta_scope_complete') process.exitCode = 2;
  } else console.log(JSON.stringify(report, null, 2));
  writeJSON(path.join(root, '.gameprod/evidence/beta-readiness.json'), report);
}
