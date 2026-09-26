import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveComponent } from '../../../scripts/device-launch.mjs';
test('only a unique launcher within the selected package is accepted', () => {
  const p = 'pro.neurofox.multimental.dev';
  assert.equal(
    resolveComponent('priority=0\n' + p + '/com.godot.game.GodotAppLauncher\n', p),
    p + '/com.godot.game.GodotAppLauncher'
  );
  for (const text of ['other.app/Launcher', p + '/A\n' + p + '/B', p + '/A; rm', ''])
    assert.throws(() => resolveComponent(text, p));
});
