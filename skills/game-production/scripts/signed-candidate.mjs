import fs from 'node:fs';
import { signRecoveryAction } from './effect-recovery-policy.mjs';

export function ensureSignedCandidate({
  finalFile,
  stagingFile,
  verify,
  sign,
  promote = (from, to) => fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL),
  exists = fs.existsSync
}) {
  if (
    typeof finalFile !== 'string' ||
    !finalFile ||
    typeof stagingFile !== 'string' ||
    !stagingFile ||
    finalFile === stagingFile ||
    typeof verify !== 'function' ||
    typeof sign !== 'function' ||
    typeof promote !== 'function' ||
    typeof exists !== 'function'
  )
    throw Error('SIGNED_CANDIDATE_INPUT');

  const inspect = (file) => (exists(file) ? verify(file) === true : false);
  let finalExists = exists(finalFile),
    stagingExists = exists(stagingFile),
    finalValid = finalExists ? inspect(finalFile) : false,
    stagingValid = stagingExists ? inspect(stagingFile) : false;
  const decision = signRecoveryAction({ finalExists, finalValid, stagingExists, stagingValid });

  if (decision.action === 'sign_once') {
    sign(stagingFile);
    if (!exists(stagingFile) || !inspect(stagingFile))
      throw Error('SIGNED_CANDIDATE_SIGN_NOT_VERIFIED');
    stagingExists = true;
    stagingValid = true;
    promote(stagingFile, finalFile);
  } else if (decision.action === 'promote_staging') {
    promote(stagingFile, finalFile);
  }

  finalExists = exists(finalFile);
  finalValid = finalExists ? inspect(finalFile) : false;
  if (!finalExists || !finalValid) throw Error('SIGNED_CANDIDATE_FINAL_NOT_VERIFIED');
  return {
    action: decision.action,
    finalFile,
    stagingPreserved: stagingExists && exists(stagingFile)
  };
}
