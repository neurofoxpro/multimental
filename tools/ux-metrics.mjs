export function summarizeUi(report) {
  if (
    report?.schemaVersion !== 1 ||
    report.personalProfileUsed !== false ||
    !Array.isArray(report.samples) ||
    report.samples.length !== 24
  )
    throw Error('Incomplete isolated UI sample');
  const seen = new Set();
  const summary = report.samples.map((sample) => {
    if (
      !['ru', 'en'].includes(sample.locale) ||
      !['menu', 'collection', 'battle', 'shop'].includes(sample.page) ||
      !Array.isArray(sample.viewport) ||
      !['720x1280', '720x1440', '1280x720'].includes(sample.viewport.join('x')) ||
      JSON.stringify(sample.viewport) !== JSON.stringify(sample.requested)
    )
      throw Error('Wrong measurement dimensions');
    const key = sample.locale + '/' + sample.page + '/' + sample.viewport.join('x');
    if (seen.has(key)) throw Error('Duplicate UI sample');
    seen.add(key);
    if (
      !Array.isArray(sample.controls) ||
      sample.controls.length === 0 ||
      sample.controls.length > 2000
    )
      throw Error('Empty or oversized UI traversal');
    for (const control of sample.controls) {
      if (
        typeof control.path !== 'string' ||
        typeof control.target !== 'boolean' ||
        ![control.size, control.visible_size].every(
          (pair) =>
            Array.isArray(pair) &&
            pair.length === 2 &&
            pair.every((n) => Number.isFinite(n) && n >= 0)
        ) ||
        !Number.isFinite(control.font) ||
        control.font <= 0
      )
        throw Error('Invalid measured control');
    }
    const targets = sample.controls.filter((c) => c.target);
    if (!targets.length) throw Error('No measured targets');
    return {
      locale: sample.locale,
      page: sample.page,
      viewport: sample.viewport,
      targets: targets.length,
      smallestTarget: Math.min(...targets.map((c) => Math.min(...c.size))),
      smallestVisibleTarget: Math.min(...targets.map((c) => Math.min(...c.visible_size))),
      smallestFont: Math.min(...sample.controls.map((c) => c.font)),
      initialFocus: sample.focus_present === true,
      clippedNonScroll: targets
        .filter((c) => !c.in_scroll && !c.fully_in_viewport)
        .map((c) => ({ path: c.path, text: c.text }))
    };
  });
  return {
    status: 'measured_not_accessibility_certified',
    units: 'Godot viewport units',
    summary,
    compliance: 'dp/CSS size, assistive technology and human comfort require separate evidence'
  };
}
export function contrastRatio(left, right) {
  const luminance = (rgb) => {
    if (
      !Array.isArray(rgb) ||
      rgb.length !== 3 ||
      rgb.some((n) => !Number.isFinite(n) || n < 0 || n > 1)
    )
      throw Error('Normalized RGB required');
    const linear = rgb.map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  };
  const a = luminance(left),
    b = luminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
