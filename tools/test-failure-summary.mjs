/** Keep the first actionable failure, not only successful tests from the log tail. */
export function testFailureSummary(text, limit = 12000) {
  if (
    typeof text !== 'string' ||
    text.length > 32 * 1024 * 1024 ||
    !Number.isInteger(limit) ||
    limit < 512 ||
    limit > 65536
  )
    throw Error('TEST_SUMMARY_INPUT');
  const lines = text.split(/\r?\n/);
  const keep = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (/^(?:not ok|#\s*(?:Error|.*ERR_[A-Z_]+))|^\s*(?:failureType|error|code):/.test(lines[i])) {
      for (let j = Math.max(0, i - 3); j <= Math.min(lines.length - 1, i + 12); j++) keep.add(j);
    }
  }
  const totals = lines
    .filter((l) => /^# (?:tests|pass|fail|cancelled|skipped|duration_ms) /.test(l))
    .join('\n');
  const excerpt = keep.size
    ? [...keep]
        .sort((a, b) => a - b)
        .map((i) => lines[i])
        .join('\n')
    : text.slice(-Math.floor(limit / 2));
  const note = '\n[Full source log: .gameprod/evidence/source-tests.log]\n';
  return (totals + '\n' + excerpt).slice(0, limit - note.length) + note;
}
