import * as prettier from 'prettier';
/** Return a fixed point, not a first pass that a read-only check immediately rejects. */
export async function stableFormat(
  input,
  options,
  { format = prettier.format, maxPasses = 4 } = {}
) {
  if (
    typeof input !== 'string' ||
    !Number.isInteger(maxPasses) ||
    maxPasses < 1 ||
    maxPasses > 8 ||
    typeof format !== 'function'
  )
    throw Error('FORMAT_STABILITY_INPUT');
  let current = input;
  const seen = new Set([current]);
  for (let pass = 0; pass < maxPasses; pass++) {
    const next = await format(current, options);
    if (typeof next !== 'string') throw Error('FORMAT_INVALID_OUTPUT');
    if (next === current) return current;
    if (seen.has(next)) throw Error('FORMAT_OSCILLATION');
    seen.add(next);
    current = next;
  }
  throw Error('FORMAT_DID_NOT_CONVERGE');
}
