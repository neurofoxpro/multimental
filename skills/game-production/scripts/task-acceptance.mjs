import { sha } from './lib.mjs';
import { readTask } from './issue-memory.mjs';
import { assertProof } from './short-workflow-core.mjs';
/** The caller verifies source, claims and CI. This function owns only the guarded Issue mutation. */
export async function acceptIssue({ client, issue, proof, reference, proofHash, record }) {
  if (
    !Number.isSafeInteger(issue) ||
    issue < 1 ||
    !/^docs\/production\/evidence\/[A-Za-z0-9_.-]+\.json$/.test(reference || '') ||
    !/^[a-f0-9]{64}$/.test(proofHash || '') ||
    typeof record !== 'function'
  )
    throw Error('ACCEPT_WRITE_INPUT');
  const fresh = await client.api('GET', '/issues/' + issue);
  const parsed = readTask(fresh);
  if (!parsed) throw Error('ACCEPT_UNTRUSTED_ISSUE');
  assertProof(proof, parsed.task);
  const next = {
    ...parsed.task,
    status: 'verified',
    evidence: [...new Set([...parsed.task.evidence, ...proof.evidence, reference])]
  };
  const pattern =
    /(<!-- gameprod:definition:start -->\s*```json\s*)([\s\S]*?)(\s*```\s*<!-- gameprod:definition:end -->)/g;
  let replacements = 0;
  const body = fresh.body.replace(pattern, (_all, start, _value, end) => {
    replacements++;
    return start + JSON.stringify(next, null, 2) + end;
  });
  if (replacements !== 1) throw Error('ACCEPT_DEFINITION_COUNT');
  await record(
    'Инженерная приёмка по ' +
      reference +
      ' (SHA256 ' +
      proofHash +
      '), source ' +
      proof.sourceCommit +
      '. Критерии сверены с текущим определением; PR/CI/source-seal и versioned evidence проверены. Историческая verified не квалифицирует новый RC и не заменяет ручную оценку или production-согласие.'
  );
  let actual = await client.api('GET', '/issues/' + issue);
  const unchanged = actual.body === body && actual.state === 'closed';
  let recoveredReply = false;
  if (!unchanged) {
    if (sha(actual.body) !== parsed.bodySha256) throw Error('ACCEPT_ISSUE_CHANGED');
    try {
      await client.api('PATCH', '/issues/' + issue, {
        body,
        state: 'closed',
        state_reason: 'completed'
      });
    } catch (e) {
      actual = await client.api('GET', '/issues/' + issue);
      if (actual.body !== body || actual.state !== 'closed') throw e;
      recoveredReply = true;
    }
  }
  actual = await client.api('GET', '/issues/' + issue);
  if (actual.body !== body || actual.state !== 'closed') throw Error('ACCEPT_READBACK_MISMATCH');
  return { issue, bodySha256: sha(actual.body), unchanged, recoveredReply };
}
