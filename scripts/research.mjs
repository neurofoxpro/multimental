import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import {
  readJSON,
  writeJSON,
  sha,
  context,
  findRoot
} from '../skills/game-production/scripts/lib.mjs';
export function validateResearch(data, root) {
  if (data?.schemaVersion !== 1 || !Array.isArray(data.records))
    throw Error('Research schema required');
  const ids = new Set();
  for (const r of data.records) {
    if (!/^[A-Z0-9-]+$/.test(r.id) || ids.has(r.id) || !r.question || !r.recommendation)
      throw Error('Invalid/duplicate research record');
    ids.add(r.id);
    if (
      ![
        'open',
        'proposed',
        'tested_recommendation',
        'tested_workaround',
        'accepted',
        'deferred'
      ].includes(r.status)
    )
      throw Error('Research status invalid');
    if (
      !Array.isArray(r.sources) ||
      !r.sources.length ||
      !Array.isArray(r.tests) ||
      !r.tests.length ||
      !Array.isArray(r.limits)
    )
      throw Error('Research needs sources/tests/limits');
    for (const s of r.sources) {
      const u = new URL(s.url);
      if (
        u.protocol !== 'https:' ||
        u.username ||
        u.password ||
        ![
          'docs.godotengine.org',
          'developer.android.com',
          'docs.github.com',
          'learn.microsoft.com',
          'github.com',
          'semver.org',
          'keepachangelog.com'
        ].includes(u.hostname) ||
        !s.claim
      )
        throw Error('Primary source reference required');
    }
    for (const t of r.tests) {
      const f = path.resolve(root, t);
      if (!f.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(f))
        throw Error('Missing research verification ' + t);
    }
  }
  return true;
}
const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  const root = findRoot(),
    d = readJSON(path.join(root, '.gameprod/research.json'));
  validateResearch(d, root);
  const command = process.argv[2] || 'check';
  if (command === 'check') console.log('RESEARCH_LEDGER_PASS records=' + d.records.length);
  else if (command === 'plan')
    console.log(
      JSON.stringify(
        d.records.map((r) => ({
          id: r.id,
          status: r.status,
          question: r.question,
          tests: r.tests,
          limits: r.limits
        })),
        null,
        2
      )
    );
  else if (command === 'capture') {
    context(root, readJSON(path.join(root, '.gameprod/project.json')));
    const observations = [];
    for (const url of [...new Set(d.records.flatMap((r) => r.sources.map((s) => s.url)))]) {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(30000),
        headers: { 'User-Agent': 'MultimentalResearch/1' }
      });
      if (!response.ok) throw Error('Research source returned ' + response.status);
      const text = await response.text();
      if (text.length > 5000000) throw Error('Research source oversized');
      observations.push({
        url,
        observedAt: new Date().toISOString(),
        sha256: sha(text),
        etag: response.headers.get('etag')
      });
    }
    writeJSON('.gameprod/evidence/research-sources.json', { schemaVersion: 1, observations });
    console.log('RESEARCH_SOURCES_CAPTURED ' + observations.length);
  } else throw Error('research: check|plan|capture');
}
