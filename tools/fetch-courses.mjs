// Builds the course catalog that ships with the app, in data/courses/:
//
//   catalog.json      every golf course OpenStreetMap has in the region, with
//                     its center, how many holes are mapped, and its file
//   osm-*.json        full hole data for each course that has holes mapped
//
// The app reads these instead of asking OpenStreetMap's public servers, which
// are often slow or down. Runs on GitHub Actions
// (.github/workflows/fetch-courses.yml), which has the internet access this needs.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { loadCourse } from '../js/osm.js';

// Northwest Arkansas: Fayetteville, Johnson, Springdale, Rogers, Bentonville,
// Bella Vista. Widen the box to cover more courses.
const REGION = { south: 35.95, west: -94.45, north: 36.5, east: -93.95 };

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
async function overpass(query) {
  for (const url of SERVERS) {
    const host = new URL(url).hostname;
    const t0 = Date.now();
    try {
      const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(90000) });
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      if (!res.ok) { console.log(`    ${host}: HTTP ${res.status} after ${secs} s`); continue; }
      console.log(`    ${host}: OK after ${secs} s`);
      return await res.json();
    } catch (e) {
      console.log(`    ${host}: ${e.name === 'TimeoutError' ? 'no answer in 90 s' : e.message}`);
    }
  }
  throw new Error('every server failed');
}

const outDir = new URL('../data/courses/', import.meta.url);
await mkdir(outDir, { recursive: true });

let previous = [];
try { previous = JSON.parse(await readFile(new URL('catalog.json', outDir), 'utf8')); } catch { /* first run */ }

const bbox = `${REGION.south},${REGION.west},${REGION.north},${REGION.east}`;

console.log('Listing golf courses and mapped holes in the region…');
let courses, holes;
try {
  courses = (await overpass(`[out:json][timeout:60];(way["leisure"="golf_course"](${bbox});relation["leisure"="golf_course"](${bbox}););out tags bb;`)).elements;
  holes = (await overpass(`[out:json][timeout:60];way["golf"="hole"](${bbox});out tags center;`)).elements;
} catch (e) {
  console.log(`Couldn't list the region (${e.message}). Keeping the existing catalog.`);
  process.exit(0);
}

const inBounds = (p, b) => p.lat >= b.minlat && p.lat <= b.maxlat && p.lon >= b.minlon && p.lon <= b.maxlon;

const catalog = [];
for (const el of courses) {
  const b = el.bounds;
  if (!b) continue;
  const mapped = holes.filter(h => h.center && inBounds(h.center, b)).length;
  const name = el.tags?.name;
  if (!name && mapped === 0) continue; // an unnamed outline with nothing in it helps nobody
  if (el.tags?.sport === 'disc_golf' || /disc ?golf/i.test(name || '')) continue;
  const entry = {
    osm: `${el.type}/${el.id}`,
    name: name || 'Unnamed golf course',
    center: [+((b.minlat + b.maxlat) / 2).toFixed(5), +((b.minlon + b.maxlon) / 2).toFixed(5)],
    holes: 0,
    file: null,
  };
  console.log(`\n=== ${entry.name} [${entry.osm}]: ${mapped} hole line(s) in its box`);

  if (mapped > 0) {
    try {
      const { course, report } = await loadCourse({ type: el.type, id: el.id, name: entry.name, bounds: b });
      const file = `${course.id}.json`;
      await writeFile(new URL(file, outDir), JSON.stringify(course));
      entry.holes = course.holes.length;
      entry.file = file;
      console.log(`  saved ${file}: holes ${course.holes.map(h => `${h.number}${h.par ? `(p${h.par})` : '(p?)'}${h.greenOutline ? '' : '[no green]'}`).join(' ')}`);
      console.log(`  report: ${JSON.stringify(report)}; hazards: ${course.hazards.length}`);
    } catch (e) {
      const old = previous.find(p => p.osm === entry.osm && p.file);
      if (old) Object.assign(entry, { holes: old.holes, file: old.file });
      console.log(`  couldn't load (${e.message})${old ? `; keeping ${old.file}` : ''}`);
    }
  }
  catalog.push(entry);
}

catalog.sort((a, b) => a.name.localeCompare(b.name));
await writeFile(new URL('catalog.json', outDir), JSON.stringify(catalog, null, 2) + '\n');
console.log(`\nCatalog: ${catalog.length} courses, ${catalog.filter(c => c.file).length} with holes mapped.`);
