// Fetches the preset courses from OpenStreetMap and saves them to
// data/courses/, so the app can open them without waiting on the free
// Overpass servers. Runs on GitHub Actions (.github/workflows/fetch-courses.yml),
// which has the open internet access this needs. Also prints what
// OpenStreetMap actually has for each course, to show what's missing.

import { mkdir, writeFile } from 'node:fs/promises';
import { PRESETS, findCoursesByName, loadCourse } from '../js/osm.js';

// Overpass asks scripts to identify themselves.
const realFetch = globalThis.fetch;
globalThis.fetch = (url, opts = {}) => realFetch(url, {
  ...opts,
  headers: { 'User-Agent': 'T2G course fetcher (github.com/Juanpablohoyosc/T2G)', ...(opts.headers || {}) },
});

const SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// Tries each server in turn and logs how each one answered.
async function rawOverpass(query) {
  for (const url of SERVERS) {
    const host = new URL(url).hostname;
    const t0 = Date.now();
    try {
      const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(60000) });
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      if (!res.ok) { console.log(`    ${host}: HTTP ${res.status} after ${secs} s`); continue; }
      const cors = res.headers.get('access-control-allow-origin');
      console.log(`    ${host}: OK after ${secs} s (CORS: ${cors || 'none'})`);
      return await res.json();
    } catch (e) {
      console.log(`    ${host}: ${e.name === 'TimeoutError' ? 'no answer in 60 s' : e.message}`);
    }
  }
  throw new Error('every server failed');
}

const outDir = new URL('../data/courses/', import.meta.url);
await mkdir(outDir, { recursive: true });

console.log('Golf courses mapped in Northwest Arkansas:');
const all = await rawOverpass('[out:json][timeout:25];(way["leisure"="golf_course"](35.95,-94.45,36.45,-93.95);relation["leisure"="golf_course"](35.95,-94.45,36.45,-93.95););out tags bb;');
for (const el of all.elements) console.log(`  - ${el.tags?.name || '(no name)'}  [${el.type}/${el.id}]`);

const index = [];
for (const preset of PRESETS) {
  console.log(`\n=== ${preset.label}`);
  try {
    const found = await findCoursesByName(preset.name);
    if (!found.length) { console.log('  not found by name'); continue; }
    const wanted = preset.name.toLowerCase();
    const summary = found.find(c => c.name.toLowerCase().includes(wanted)) || found[0];
    console.log(`  matched: ${summary.name} [${summary.type}/${summary.id}]`);

    const b = summary.bounds;
    const tags = await rawOverpass(`[out:json][timeout:25];(node["golf"](${b.minlat},${b.minlon},${b.maxlat},${b.maxlon});way["golf"](${b.minlat},${b.minlon},${b.maxlat},${b.maxlon});relation["golf"](${b.minlat},${b.minlon},${b.maxlat},${b.maxlon}););out tags;`);
    const counts = {};
    for (const el of tags.elements) counts[el.tags.golf] = (counts[el.tags.golf] || 0) + 1;
    console.log(`  golf features inside its outline box: ${JSON.stringify(counts)}`);

    const { course, report } = await loadCourse(summary);
    console.log(`  holes: ${course.holes.map(h => `${h.number}${h.par ? `(p${h.par})` : '(p?)'}${h.greenOutline ? '' : '[no green]'}`).join(' ')}`);
    console.log(`  report: ${JSON.stringify(report)}; hazards: ${course.hazards.length}`);
    const file = `${course.id}.json`;
    await writeFile(new URL(file, outDir), JSON.stringify(course));
    index.push({ preset: preset.name, file, name: course.name, holes: course.holes.length });
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
}

await writeFile(new URL('index.json', outDir), JSON.stringify(index, null, 2) + '\n');
console.log(`\nSaved ${index.length} course file(s).`);
