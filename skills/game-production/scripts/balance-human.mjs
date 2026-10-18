import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRoot, inside, readJSON, context } from './lib.mjs';
import { validateSeries, summarizeSeries } from './balance-human-policy.mjs';

function safeInput(root, rel) {
  if (
    typeof rel !== 'string' ||
    !rel ||
    rel.includes('..') ||
    rel.includes('\\') ||
    rel.startsWith('/') ||
    !/^[A-Za-z0-9_./-]+\.json$/.test(rel) ||
    !(rel.startsWith('.gameprod/evidence/') || rel.startsWith('docs/production/evidence/'))
  )
    throw Error('HUMAN_DURATION_INPUT_PATH');
  return inside(root, rel);
}

export async function main(args = process.argv.slice(2)) {
  const [mode = 'check', file, ...extra] = args;
  if (!['check', 'summary'].includes(mode) || !file || extra.length)
    throw Error('balance human check|summary .gameprod/evidence/FILE.json');
  const root = findRoot();
  const project = readJSON(inside(root, '.gameprod/project.json'));
  context(root, project);
  const source = safeInput(root, file);
  const stat = fs.lstatSync(source);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 1024 * 1024)
    throw Error('HUMAN_DURATION_INPUT_FILE');
  const data = readJSON(source);
  const result =
    mode === 'check'
      ? (() => {
          const s = validateSeries(data);
          return {
            status: 'valid',
            releaseTag: s.releaseTag,
            sourceCommit: s.sourceCommit,
            rows: s.matches.length,
            usable: s.matches.filter((r) => !r.interrupted).length,
            interrupted: s.matches.filter((r) => r.interrupted).length,
            humanAcceptance: 'pending',
            source: file
          };
        })()
      : summarizeSeries(data);
  console.log(JSON.stringify(result, null, 2));
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error('BALANCE_HUMAN_BLOCKED: ' + e.message);
    process.exitCode = 1;
  });
