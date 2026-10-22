// One-off check of OpenGolfAPI (opengolfapi.org) and of free imagery tile
// servers, run on GitHub Actions (.github/workflows/probe-sources.yml).

const HEADERS = {
  'User-Agent': 'T2G source check (github.com/Juanpablohoyosc/T2G)',
  Origin: 'https://juanpablohoyosc.github.io',
};
const API = 'https://api.opengolfapi.org';

const NAMES = [
  'Links at Fayetteville', 'Links at Bentonville', 'Rainbow Curve', 'Blessings',
  'Bella Vista Country Club', 'Brittany', 'Brush Creek', 'Dogwood', 'Kingswood',
  'Scotsdale', 'Greens on Blossom Way', 'Lakeside Village',
];

async function get(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
  const body = await res.text();
  return { res, body, cors: res.headers.get('access-control-allow-origin') || 'none' };
}

// The shape of a JSON value: keys, types and array lengths, a few levels deep.
function shape(v, depth = 0) {
  if (depth > 5) return '…';
  if (Array.isArray(v)) return v.length ? `[${v.length}× ${shape(v[0], depth + 1)}]` : '[]';
  if (v && typeof v === 'object') {
    return `{ ${Object.entries(v).map(([k, x]) => `${k}: ${shape(x, depth + 1)}`).join(', ')} }`;
  }
  return typeof v === 'string' ? JSON.stringify(v.slice(0, 40)) : String(v);
}

console.log('#### API guide');
try {
  const { res, body, cors } = await get(`${API}/llms.txt`);
  console.log(`HTTP ${res.status} | CORS ${cors}`);
  console.log(body.slice(0, 9000));
} catch (e) { console.log(`failed: ${e.message}`); }

console.log('\n#### OpenAPI paths');
try {
  const { res, body } = await get(`${API}/openapi.json`);
  const spec = JSON.parse(body);
  console.log(`HTTP ${res.status}`);
  for (const [path, ops] of Object.entries(spec.paths || {})) {
    if (/course|hole|geom|search|near|state/i.test(path)) {
      console.log(`  ${Object.keys(ops).join(',').toUpperCase()} ${path}  ${Object.values(ops)[0]?.summary || ''}`);
    }
  }
} catch (e) { console.log(`failed: ${e.message}`); }

let detailed = 0;
for (const name of NAMES) {
  console.log(`\n#### search: ${name}`);
  try {
    const { res, body, cors } = await get(`${API}/v1/courses/search?q=${encodeURIComponent(name)}&state=AR`);
    console.log(`HTTP ${res.status} | CORS ${cors}`);
    const data = JSON.parse(body);
    const list = Array.isArray(data) ? data : data.results || data.courses || data.data || [];
    const ar = list.filter(c => JSON.stringify(c).includes('AR'));
    for (const c of ar.slice(0, 4)) {
      console.log(`  - ${c.name || c.course_name} | ${c.city || ''} ${c.state || ''} | id ${c.id || c.course_id} | ${JSON.stringify(c).slice(0, 300)}`);
    }
    if (!ar.length) console.log(`  no Arkansas match (${list.length} results): ${body.slice(0, 300)}`);
    const pick = ar[0];
    if (pick) {
      const id = pick.id || pick.course_id || pick.slug;
      const d = await get(`${API}/v1/courses/${encodeURIComponent(id)}`);
      const course = JSON.parse(d.body);
      console.log(`  detail HTTP ${d.res.status} | CORS ${d.cors}`);
      console.log(`  shape: ${shape(course).slice(0, 2500)}`);
      if (detailed++ < 2) console.log(`  raw: ${d.body.slice(0, 4000)}`);
    }
  } catch (e) { console.log(`failed: ${e.message}`); }
}

// Free satellite imagery over Blessings Golf Club, hole 1 green.
console.log('\n#### imagery tiles');
const lat = 36.134216, lon = -94.196018;
const tileXY = z => {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n);
  return { x, y };
};
const servers = {
  esri: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
  usgs: (z, x, y) => `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/${z}/${y}/${x}`,
};
for (const [name, url] of Object.entries(servers)) {
  for (const z of [15, 16, 17, 18, 19]) {
    const { x, y } = tileXY(z);
    try {
      const res = await fetch(url(z, x, y), { headers: HEADERS, signal: AbortSignal.timeout(20000) });
      const buf = Buffer.from(await res.arrayBuffer());
      console.log(`  ${name} z${z}: HTTP ${res.status} ${res.headers.get('content-type')} ${buf.length} bytes | CORS ${res.headers.get('access-control-allow-origin') || 'none'}`);
    } catch (e) { console.log(`  ${name} z${z}: ${e.message}`); }
  }
}
for (const url of ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer?f=pjson']) {
  try {
    const { body } = await get(url);
    const info = JSON.parse(body);
    console.log(`  USGS service: maxScale ${info.maxScale}, LODs ${info.tileInfo?.lods?.map(l => l.level).join(',')}, copyright: ${info.copyrightText}`);
  } catch (e) { console.log(`  USGS info failed: ${e.message}`); }
}
