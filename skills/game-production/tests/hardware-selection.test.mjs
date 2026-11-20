import test from 'node:test';
import assert from 'node:assert/strict';
import { hardwareSensitive } from '../scripts/qualification-policy.mjs';
test('transport changes automatically require physical qualification', () => {
  for (const f of [
    'game/src/net/bluetooth_channel.gd',
    'game/src/net/lan_session.gd',
    'game/src/match_view.gd',
    'game/export_presets.cfg',
    'tools/BluetoothChannel.cs',
    'scripts/bluetooth-room-test.mjs'
  ])
    assert.equal(hardwareSensitive([f]), true);
});
test('ordinary documentation and UI changes do not force hardware', () => {
  assert.equal(hardwareSensitive(['docs/A.md', 'game/src/main.gd', 'scripts/handoff.mjs']), false);
  assert.equal(hardwareSensitive(null), true);
});
