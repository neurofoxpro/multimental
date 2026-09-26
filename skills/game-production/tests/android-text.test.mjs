import test from 'node:test';
import assert from 'node:assert/strict';
import { adbLines, dedicatedEmulator } from '../scripts/android-text.mjs';
test('CRCRLF, CRLF and LF return the same explicit AVD identity', () => {
  for (const end of ['\r\r\n', '\r\n', '\n'])
    assert.equal(
      dedicatedEmulator('Multimental_Test_A' + end + 'OK' + end, '1\r\n', 'Multimental_Test_A'),
      true
    );
});
test('unexpected name, host phone and ambiguous output fail closed', () => {
  assert.equal(dedicatedEmulator('Multimental_Test_B\nOK', '1', 'Multimental_Test_A'), false);
  assert.equal(dedicatedEmulator('Multimental_Test_A\nOK', '0', 'Multimental_Test_A'), false);
  assert.equal(
    dedicatedEmulator('Multimental_Test_A\nOTHER\nOK', '1', 'Multimental_Test_A'),
    false
  );
  assert.throws(() => dedicatedEmulator('any', '1', 'any'));
  assert.deepEqual(adbLines(' A\r\r\n B\n'), ['A', 'B']);
});
