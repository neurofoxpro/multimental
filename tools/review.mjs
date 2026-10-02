import fs from 'node:fs';
import path from 'node:path';
import { writeJSON, readJSON, fingerprint } from '../skills/game-production/scripts/lib.mjs';
const root = process.cwd(),
  p = readJSON('.gameprod/project.json'),
  checks = [];
function check(name, ok, detail) {
  checks.push({ name, status: ok ? 'passed' : 'failed', detail });
  if (!ok) console.error('REVIEW_FAIL ' + name + ' ' + detail);
}
for (const name of fs.readdirSync('.github/workflows').filter((x) => /\.ya?ml$/.test(x))) {
  const text = fs.readFileSync(path.join('.github/workflows', name), 'utf8');
  check(
    name + ':no-privileged-pr',
    !text.includes('pull_request_target'),
    'Untrusted PRs must not receive elevated execution'
  );
  check(
    name + ':hosted-only',
    !text.includes('self-hosted'),
    'No generic personal-computer runner'
  );
  for (const m of text.matchAll(/uses:\s*([^\s#]+)/g)) {
    const ref = m[1];
    check(
      name + ':pinned:' + ref,
      /^\.\//.test(ref) || /@[a-f0-9]{40}$/.test(ref),
      'Pin exact external action source'
    );
  }
}
const inputs = p.inputs || [];
check(
  'lockfile-in-source-fingerprint',
  inputs.includes('package-lock.json'),
  'Dependency lock must invalidate test receipts'
);
check(
  'content-notes-in-source-fingerprint',
  inputs.includes('changes'),
  'Release descriptions are part of reviewed inputs'
);
check(
  'public-data-boundary',
  fs.readFileSync('.gitignore', 'utf8').includes('*.local.json'),
  'Local station config excluded'
);
const s = fs.readFileSync('scripts/device-test.mjs', 'utf8');
check(
  'no-phone-clean-install',
  s.includes('Real phone data removal is not authorized by this tool'),
  'Only dedicated emulators allow clearing test package'
);
const report = {
  schemaVersion: 1,
  kind: 'automated-invariant-review',
  independentHumanReview: false,
  observedAt: new Date().toISOString(),
  sourceDigest: fingerprint(root, p),
  status: checks.every((x) => x.status === 'passed') ? 'passed' : 'failed',
  checks
};
writeJSON('.gameprod/evidence/review.json', report);
if (report.status !== 'passed') process.exitCode = 1;
else console.log('AUTOMATED_REVIEW_PASS checks=' + checks.length);
