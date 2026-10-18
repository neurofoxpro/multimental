import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeUi, contrastRatio } from '../../../tools/ux-metrics.mjs';
function fixture() {
  return {
    schemaVersion: 1,
    personalProfileUsed: false,
    samples: ['ru', 'en'].flatMap((locale) =>
      ['menu', 'collection', 'battle', 'shop'].flatMap((page) =>
        [
          [720, 1280],
          [720, 1440],
          [1280, 720]
        ].map((viewport) => ({
          locale,
          page,
          viewport,
          requested: [...viewport],
          focus_present: false,
          controls: [
            {
              path: '/button',
              text: 'Test',
              size: [96, 54],
              visible_size: [96, 10],
              font: 16,
              target: true,
              in_scroll: true,
              fully_in_viewport: false
            }
          ]
        }))
      )
    )
  };
}
test('measures exact 24 combinations without certifying accessibility', () => {
  const r = summarizeUi(fixture());
  assert.equal(r.summary.length, 24);
  assert.match(r.status, /not_accessibility/);
  assert.equal(r.summary[0].smallestTarget, 54);
  assert.equal(r.summary[0].smallestVisibleTarget, 10);
  assert.deepEqual(r.summary[0].clippedNonScroll, []);
});
for (const [name, change] of [
  ['missing sample', (r) => r.samples.pop()],
  ['duplicate', (r) => (r.samples[1] = r.samples[0])],
  ['wrong actual viewport', (r) => (r.samples[0].viewport = [360, 640])],
  ['wrong requested viewport', (r) => (r.samples[0].requested = [720, 1440])],
  ['personal fixture', (r) => (r.personalProfileUsed = true)],
  ['missing controls', (r) => (r.samples[0].controls = [])],
  ['negative size', (r) => (r.samples[0].controls[0].size[0] = -1)],
  ['nonfinite font', (r) => (r.samples[0].controls[0].font = NaN)],
  ['unsupported locale', (r) => (r.samples[0].locale = 'zz')]
])
  test('rejects ' + name, () => {
    const r = fixture();
    change(r);
    assert.throws(() => summarizeUi(r));
  });
test('reports actually clipped nonscroll target separately', () => {
  const r = fixture();
  r.samples[0].controls[0].in_scroll = false;
  assert.equal(summarizeUi(r).summary[0].clippedNonScroll.length, 1);
});
test('contrast reference pairs and symmetry', () => {
  assert.equal(contrastRatio([0, 0, 0], [1, 1, 1]), 21);
  assert.equal(contrastRatio([0.5, 0.5, 0.5], [0.5, 0.5, 0.5]), 1);
  assert.equal(contrastRatio([1, 0, 0], [0, 0, 1]), contrastRatio([0, 0, 1], [1, 0, 0]));
});
for (const value of [[], [1, 2, 3], [NaN, 0, 0], [-1, 0, 0], null])
  test('rejects invalid color ' + String(value), () =>
    assert.throws(() => contrastRatio(value, [0, 0, 0]))
  );
