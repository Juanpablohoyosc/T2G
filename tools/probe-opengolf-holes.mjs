// One-off: does OpenGolfAPI have hole/green geometry? (GitHub Actions only.)
const HEADERS = { 'User-Agent': 'T2G source check (github.com/Juanpablohoyosc/T2G)', Origin: 'https://juanpablohoyosc.github.io' };
const API = 'https://api.opengolfapi.org';
const COURSES = {
  'Links at Fayetteville': { id: '94d70434-4dd3-409e-8ba5-d7598c6a846c', at: [36.0804460967, -94.2115187645] },
  'Blessings': { id: 'a8cd5e76-d6f8-48dc-a8f3-6f577fc3936b', at: [36.134216, -94.196018] },
};
async function show(label, url, max = 3500) {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
    const body = await res.text();
    console.log(`\n#### ${label}\n${url}\nHTTP ${res.status} | CORS ${res.headers.get('access-control-allow-origin') || 'none'} | ${body.length} bytes`);
    console.log(body.slice(0, max));
  } catch (e) { console.log(`\n#### ${label}: ${e.message}`); }
}
const guide = await (await fetch(`${API}/llms.txt`, { headers: HEADERS })).text();
const k = guide.indexOf('## Key endpoints');
console.log(guide.slice(k, k + 6000));
for (const [name, c] of Object.entries(COURSES)) {
  await show(`${name}: full detail`, `${API}/api/v1/courses/${c.id}`, 2500);
  await show(`${name}: holes`, `${API}/api/v1/courses/${c.id}/holes`, 5000);
  await show(`${name}: hole 1`, `${API}/api/v1/courses/${c.id}/holes/1`, 3000);
  await show(`${name}: nearest features`, `${API}/api/v1/features/nearest?lat=${c.at[0]}&lng=${c.at[1]}&k=10`, 4000);
}
