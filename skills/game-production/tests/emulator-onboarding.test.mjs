import test from 'node:test';
import assert from 'node:assert/strict';
import { immersivePrompt } from '../../../scripts/emulator-onboarding.mjs';
const button =
  '<node resource-id="android:id/ok" package="android" class="android.widget.Button" clickable="true" bounds="[580,249][684,321]" />';
test('only Android immersive tutorial confirmation is automated', () => {
  assert.equal(immersivePrompt(button), null);
  assert.deepEqual(
    immersivePrompt('<node resource-id="android:id/immersive_cling_title" />' + button),
    [632, 285]
  );
  assert.throws(() =>
    immersivePrompt(
      '<node resource-id="android:id/immersive_cling_title" />' +
        button.replace('package="android"', 'package="other"')
    )
  );
  assert.throws(() =>
    immersivePrompt('<node resource-id="android:id/immersive_cling_title" />' + button + button)
  );
});
