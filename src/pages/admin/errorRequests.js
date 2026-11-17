// Admin → Errors: the request or page an error came from, made readable.
// Server errors log "GET /api/catalog/rest/tv_shows?select=…&source_key=in.(…)"
// and browser errors the page's address, both percent-encoded, and a catalog
// lookup can carry a list of 50 ids.

const BASE = 'https://binge.invalid';
const COMPARE = { eq: '=', neq: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤', like: 'like', ilike: 'like', is: 'is' };
const EXAMPLES = 3;

function decode(text) {
  try {
    return decodeURIComponent(String(text).replace(/\+/g, ' '));
  } catch {
    return String(text);
  }
}

// The items of a PostgREST list: 'a,"b,c",d' → ['a', 'b,c', 'd'].
function listItems(inner) {
  return (inner.match(/"(?:[^"\\]|\\.)*"|[^,]+/g) || []).map((item) => item.trim().replace(/^"(.*)"$/, '$1'));
}

function describeParam(key, value) {
  if (key === 'select') {
    const columns = value.split(',').map((column) => column.trim()).filter(Boolean);
    return columns.length > EXAMPLES + 1 ? `${columns.length} columns` : `columns ${columns.join(', ')}`;
  }
  if (key === 'order') {
    return `order ${value.split(',').map((part) => part.split('.').filter((word) => !/^nulls(first|last)$/.test(word)).join(' ')).join(', ')}`;
  }
  if (key === 'limit' || key === 'offset') return `${key} ${value}`;
  const list = value.match(/^(not\.)?in\.\((.*)\)$/s);
  if (list) {
    const items = listItems(list[2]);
    const examples = `${items.slice(0, EXAMPLES).join(', ')}${items.length > EXAMPLES ? ', …' : ''}`;
    return `${key} ${list[1] ? 'not ' : ''}in ${items.length} value${items.length === 1 ? '' : 's'} (${examples})`;
  }
  const compare = value.match(/^(not\.)?(eq|neq|gt|gte|lt|lte|like|ilike|is)\.(.*)$/s);
  if (compare) return `${key} ${compare[1] ? 'not ' : ''}${COMPARE[compare[2]]} ${compare[3]}`;
  return value ? `${key} = ${value}` : key;
}

// { method, target, details }: "GET"; "catalog tv_shows" for a catalog read,
// else the path ("/movies"); and the query as short parts, a long list as its
// count and first few items.
export function describeRequest(raw) {
  const text = String(raw || '').trim();
  const [, method = '', target = text] = text.match(/^([A-Z]+) (.+)$/) || [];
  let url;
  try {
    url = new URL(target, BASE);
  } catch {
    return { method, target: decode(target), details: [] };
  }
  const catalog = url.pathname.match(/^\/api\/catalog\/rest\/([\w-]+)$/);
  const details = [...url.searchParams].map(([key, value]) => describeParam(key, value));
  return { method, target: catalog ? `catalog ${catalog[1]}` : decode(url.pathname), details };
}

// The whole request, decoded, for when every value matters.
export function readableRequest(raw) {
  return decode(String(raw || ''));
}
