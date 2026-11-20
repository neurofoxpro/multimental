/** Bounded strict JSON with unique fields; never evaluate candidate text. */
export function parseContentJSON(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 1048576)
    throw Error('CONTENT_JSON_SIZE');
  let i = 0,
    nodes = 0;
  const white = () => {
    while (/[\t\r\n ]/.test(text[i] || '\x00')) i++;
  };
  const string = () => {
    const start = i++;
    let escaped = false;
    while (i < text.length) {
      const c = text[i++];
      if (!escaped && c === '"') return JSON.parse(text.slice(start, i));
      if (!escaped && c === '\\') escaped = true;
      else escaped = false;
    }
    throw Error('CONTENT_JSON_STRING');
  };
  function value(depth) {
    if (depth > 24 || ++nodes > 30000) throw Error('CONTENT_JSON_COMPLEXITY');
    white();
    if (text[i] === '"') return string();
    if (text[i] === '{') {
      i++;
      const fields = new Set();
      white();
      if (text[i] === '}') {
        i++;
        return;
      }
      while (true) {
        white();
        if (text[i] !== '"') throw Error('CONTENT_JSON_FIELD');
        const key = string();
        if (fields.has(key)) throw Error('CONTENT_JSON_DUPLICATE_FIELD:' + key);
        fields.add(key);
        white();
        if (text[i++] !== ':') throw Error('CONTENT_JSON_COLON');
        value(depth + 1);
        white();
        const end = text[i++];
        if (end === '}') return;
        if (end !== ',') throw Error('CONTENT_JSON_OBJECT');
      }
    }
    if (text[i] === '[') {
      i++;
      white();
      if (text[i] === ']') {
        i++;
        return;
      }
      while (true) {
        value(depth + 1);
        white();
        const end = text[i++];
        if (end === ']') return;
        if (end !== ',') throw Error('CONTENT_JSON_ARRAY');
      }
    }
    const m = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
      text.slice(i)
    );
    if (!m) throw Error('CONTENT_JSON_VALUE');
    i += m[0].length;
  }
  value(0);
  white();
  if (i !== text.length) throw Error('CONTENT_JSON_TRAILING');
  const parsed = JSON.parse(text);
  const scan = (x) => {
    if (typeof x === 'number' && !Number.isFinite(x)) throw Error('CONTENT_JSON_NONFINITE');
    if (x && typeof x === 'object') for (const v of Object.values(x)) scan(v);
  };
  scan(parsed);
  return parsed;
}
