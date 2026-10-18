import { createHash } from 'node:crypto';
const LABEL = 'Multimental Dev';
export function frameNodes(xml, width, height) {
  if (
    typeof xml !== 'string' ||
    xml.length > 1500000 ||
    /<!DOCTYPE|<!ENTITY/i.test(xml) ||
    !xml.includes('<hierarchy') ||
    !xml.includes('</hierarchy>') ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 100 ||
    height < 100 ||
    width > 16384 ||
    height > 16384
  )
    throw Error('Invalid launcher UI frame');
  const nodes = [];
  const decode = (s) =>
    s
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  for (const match of xml.matchAll(/<node\b([^>]*)>/g)) {
    if (nodes.length >= 3000) throw Error('Launcher UI node limit');
    const attrs = {};
    for (const field of match[1].matchAll(/([A-Za-z0-9_:-]+)="([^"]*)"/g)) {
      if (Object.hasOwn(attrs, field[1])) throw Error('Duplicate UI attribute');
      attrs[field[1]] = decode(field[2]);
    }
    const b = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(attrs.bounds || '');
    if (!b) continue;
    const [x1, y1, x2, y2] = b.slice(1).map(Number);
    nodes.push({
      ...attrs,
      box: [x1, y1, x2, y2],
      visible: x1 >= 0 && y1 >= 0 && x2 > x1 && y2 > y1 && x2 <= width && y2 <= height
    });
  }
  return nodes;
}
export function homeIcon(nodes, launcherPackage) {
  if (!/^[A-Za-z0-9_.]+$/.test(launcherPackage || ''))
    throw Error('Exact default launcher package required');
  const matches = nodes.filter(
    (n) =>
      n.package === launcherPackage &&
      n.visible &&
      n.enabled === 'true' &&
      n.clickable === 'true' &&
      (n.text === LABEL || n['content-desc'] === LABEL) &&
      /TextView|ImageView/.test(n.class || '')
  );
  if (matches.length > 1)
    throw Error('Multiple identical launcher targets need deliberate selection');
  return matches[0] || null;
}
export function pinConfirmation(nodes, launcherPackage, report, expected) {
  if (!/^[a-f0-9]{48}$/.test(expected?.nonce || '') || !expected.version)
    throw Error('Invalid explicit pin expectation');
  if (
    report?.nonce !== expected.nonce ||
    report.package !== 'pro.neurofox.multimental.dev' ||
    report.version !== expected.version ||
    report.shortcutId !== 'multimental-manual-v1' ||
    !['starting', 'requested'].includes(report.status)
  )
    throw Error('Pin confirmation does not match the active application request');
  const names = new Set([
    'Add',
    'Add automatically',
    'Add to Home screen',
    'Добавить',
    'Добавить автоматически',
    'Добавить на главный экран'
  ]);
  if (!nodes.some((n) => n.text === LABEL || n['content-desc'] === LABEL))
    throw Error('Expected shortcut title missing');
  const matches = nodes.filter(
    (n) =>
      n.package === launcherPackage &&
      n.visible &&
      n.enabled === 'true' &&
      n.clickable === 'true' &&
      names.has(n.text) &&
      /:id\/(add_item|place_automatically|confirm_button|button1)$/.test(n['resource-id'] || '')
  );
  if (matches.length !== 1) return null;
  return matches[0];
}
export function center(node) {
  if (!node?.visible || !Array.isArray(node.box) || node.box.length !== 4)
    throw Error('Visible bounded target required');
  return [Math.floor((node.box[0] + node.box[2]) / 2), Math.floor((node.box[1] + node.box[3]) / 2)];
}
export function frameHash(nodes) {
  return createHash('sha256')
    .update(
      JSON.stringify(
        nodes.map((n) => ({
          class: n.class,
          text: n.text,
          description: n['content-desc'],
          bounds: n.box,
          package: n.package
        }))
      )
    )
    .digest('hex');
}
export function nativeResult(value, expected) {
  if (
    !/^[a-f0-9]{48}$/.test(expected?.nonce || '') ||
    !/^[a-f0-9]{40}$/.test(expected?.commit || '') ||
    !expected.version
  )
    throw Error('Invalid native result expectation');
  if (
    value?.schemaVersion !== 1 ||
    value.mode !== 'ensure_home_shortcut' ||
    value.nonce !== expected.nonce ||
    value.package !== 'pro.neurofox.multimental.dev' ||
    value.version !== expected.version ||
    value.shortcutId !== 'multimental-manual-v1' ||
    !/^[a-f0-9]{7,40}$/.test(value.sourceCommit || '') ||
    !expected.commit.startsWith(value.sourceCommit) ||
    !['starting', 'requested', 'pinned', 'unsupported', 'failed', 'not_confirmed'].includes(
      value.status
    )
  )
    throw Error('Wrong native shortcut result identity');
  return value;
}
