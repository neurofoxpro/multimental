export function runtimeSucceeded(exitCode, output, marker) {
  if (exitCode !== 0 || typeof output !== 'string' || !/^[A-Z][A-Z0-9_]+$/.test(marker || ''))
    return false;
  if (/SCRIPT ERROR:|Parse Error:|^ERROR:|^[A-Z_]+_FAIL(?:ED)?(?:\s|$)/m.test(output)) return false;
  return output.split(/\r?\n/).some((line) => line === marker || line.startsWith(marker + ' '));
}
