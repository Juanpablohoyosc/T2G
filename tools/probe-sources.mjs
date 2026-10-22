// One-off check of outside golf data sources, run on GitHub Actions
// (.github/workflows/probe-sources.yml) because it needs open internet.
// Prints what each source actually returns so we can judge it for T2G.
// Usage: node tools/probe-sources.mjs [url ...]   (no args: the default list)

const HEADERS = {
  'User-Agent': 'T2G source check (github.com/Juanpablohoyosc/T2G)',
  Origin: 'https://juanpablohoyosc.github.io', // to see whether a web page may call it (CORS)
};

const DEFAULT_URLS = [
  'https://opengolfapi.org/',
  'https://opengolfapi.org/docs',
  'https://opengolfapi.org/llms.txt',
  'https://opengolfapi.org/openapi.json',
  'https://wiki.openstreetmap.org/wiki/User:Opengolfapi',
  'https://golfcourseapi.com/',
];

const text = html => html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ')
  .trim();

const urls = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_URLS;
for (const url of urls) {
  console.log(`\n######## ${url}`);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
    const type = res.headers.get('content-type') || '';
    const body = await res.text();
    console.log(`HTTP ${res.status} | ${type} | CORS allow-origin: ${res.headers.get('access-control-allow-origin') || 'none'} | ${body.length} bytes`);
    const links = [...new Set([...body.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map(m => m[0]))]
      .filter(u => /api|\/v\d|download|export|geojson|csv|github/i.test(u)).slice(0, 40);
    if (links.length) console.log(`links: ${links.join('  ')}`);
    console.log(type.includes('html') ? text(body).slice(0, 7000) : body.slice(0, 7000));
  } catch (e) {
    console.log(`failed: ${e.message}`);
  }
}
