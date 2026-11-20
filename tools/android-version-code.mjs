import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ANDROID_MAX_CODE = 2100000000;
export function androidVersionCode(runNumber, attempt) {
  if (
    !Number.isSafeInteger(runNumber) ||
    runNumber < 1 ||
    !Number.isSafeInteger(attempt) ||
    attempt < 1 ||
    attempt > 99
  )
    throw Error('ANDROID_VERSION_INPUT');
  const code = 10000 + runNumber * 100 + attempt;
  if (!Number.isSafeInteger(code) || code > ANDROID_MAX_CODE)
    throw Error('ANDROID_VERSION_OVERFLOW');
  return code;
}
export function parseCIAndroidCode(label) {
  const match = /^([1-9][0-9]*)\.([1-9][0-9]*)$/.exec(label || '');
  if (!match) throw Error('ANDROID_BUILD_LABEL');
  return androidVersionCode(Number(match[1]), Number(match[2]));
}
function main(args = process.argv.slice(2)) {
  if (args.length !== 2 || args.some((v) => !/^[1-9][0-9]*$/.test(v)))
    throw Error('Usage: android-version-code RUN_NUMBER RUN_ATTEMPT');
  console.log(androidVersionCode(Number(args[0]), Number(args[1])));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error('ANDROID_VERSION_BLOCKED: ' + error.message);
    process.exitCode = 1;
  }
}
