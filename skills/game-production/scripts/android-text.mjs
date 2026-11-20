/** ADB console on Windows may return CR-CR-LF, not just CR-LF. */
export function adbLines(text) {
  return String(text)
    .split(/[\r\n]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}
export function dedicatedEmulator(nameOutput, qemuOutput, expected) {
  if (!['Multimental_Test_A', 'Multimental_Test_B'].includes(expected))
    throw Error('Unknown dedicated AVD');
  const names = adbLines(nameOutput).filter((x) => x !== 'OK');
  return String(qemuOutput).trim() === '1' && names.length === 1 && names[0] === expected;
}
