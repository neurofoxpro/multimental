import test from 'node:test';
import assert from 'node:assert/strict';
import {
  frameNodes,
  homeIcon,
  pinConfirmation,
  center,
  frameHash,
  nativeResult
} from '../scripts/launcher-policy.mjs';
const pkg = 'com.android.launcher3';
const node = (extra = '') =>
  '<node text="Multimental Dev" content-desc="" package="' +
  pkg +
  '" class="android.widget.TextView" clickable="true" enabled="true" bounds="[10,20][150,90]" ' +
  extra +
  '/>';
const xml = (n) => '<hierarchy rotation="0">' + n + '</hierarchy>';
const expected = { nonce: 'a'.repeat(48), version: '0.13.3-test', commit: '1'.repeat(40) };
const result = () => ({
  schemaVersion: 1,
  mode: 'ensure_home_shortcut',
  ...expected,
  package: 'pro.neurofox.multimental.dev',
  shortcutId: 'multimental-manual-v1',
  sourceCommit: '1'.repeat(7),
  status: 'requested'
});
test('one actual home icon resolves to bounded tap coordinates', () => {
  const n = frameNodes(xml(node()), 720, 1280);
  assert.deepEqual(center(homeIcon(n, pkg)), [80, 55]);
  assert.match(frameHash(n), /^[a-f0-9]{64}$/);
});
test('wrong app, invisible or ambiguous icons never get tapped', () => {
  const n = frameNodes(xml(node()), 720, 1280);
  assert.equal(homeIcon(n, 'another.launcher'), null);
  assert.equal(homeIcon([{ ...n[0], visible: false }], pkg), null);
  assert.throws(() => homeIcon([...n, ...n], pkg));
  assert.equal(homeIcon([{ ...n[0], text: 'Not Multimental' }], pkg), null);
});
test('malformed frame, entity definitions and duplicate attributes are rejected', () => {
  for (const x of ['', '<!DOCTYPE a>' + xml(node()), xml(node('text="other"'))])
    assert.throws(() => frameNodes(x, 720, 1280));
  assert.throws(() => frameNodes(xml(node()), 0, 1280));
});
test('off-screen targets and UI hints cannot masquerade as actionable icons', () => {
  let n = frameNodes(xml(node().replace('[10,20][150,90]', '[10,20][850,90]')), 720, 1280);
  assert.equal(homeIcon(n, pkg), null);
  n = frameNodes(xml(node().replace('clickable="true"', 'clickable="false"')), 720, 1280);
  assert.equal(homeIcon(n, pkg), null);
});
test('only a matching native request permits the exact launcher pin button', () => {
  const button =
    '<node text="Add automatically" package="' +
    pkg +
    '" class="android.widget.Button" clickable="true" enabled="true" resource-id="' +
    pkg +
    ':id/place_automatically" bounds="[20,200][300,260]" />';
  const n = frameNodes(xml(node() + button), 720, 1280);
  assert.deepEqual(center(pinConfirmation(n, pkg, result(), expected)), [160, 230]);
  for (const wrong of [
    { nonce: 'b'.repeat(48) },
    { version: 'other' },
    { status: 'pinned' },
    { package: 'other.app' }
  ])
    assert.throws(() => pinConfirmation(n, pkg, { ...result(), ...wrong }, expected));
  assert.throws(() =>
    pinConfirmation(
      n.filter((x) => x.text !== 'Multimental Dev'),
      pkg,
      result(),
      expected
    )
  );
});
test('ambiguous or unrelated confirmation buttons are left untouched', () => {
  const n = frameNodes(
    xml(
      node() +
        '<node text="Add" package="other.app" clickable="true" enabled="true" resource-id="android:id/button1" bounds="[10,100][100,200]" />'
    ),
    720,
    1280
  );
  assert.equal(pinConfirmation(n, pkg, result(), expected), null);
});
test('native completion cannot be borrowed from another APK or nonce', () => {
  assert.equal(nativeResult(result(), expected).status, 'requested');
  for (const changed of [
    { nonce: 'b'.repeat(48) },
    { sourceCommit: '' },
    { sourceCommit: '2'.repeat(7) },
    { version: 'old' },
    { mode: 'another' },
    { status: 'success-unsupported' }
  ])
    assert.throws(() => nativeResult({ ...result(), ...changed }, expected));
});
