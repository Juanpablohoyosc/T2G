// Fetches the preset courses from OpenStreetMap and saves them to
// data/courses/, so the app can open them without waiting on the free
// Overpass servers. Runs on GitHub Actions (.github/workflows/fetch-courses.yml),
// which has the open internet access this needs. Also prints what
// OpenStreetMap actually has for each course, to show what's missing.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
let all = { elements: [] };
try {
  all = await rawOverpass('[out:json][timeout:25];(way["leisure"="golf_course"](35.95,-94.45,36.45,-93.95);relation["leisure"="golf_course"](35.95,-94.45,36.45,-93.95););out tags bb;');
} catch (e) {
  console.log(`  couldn't list courses (${e.message})`);
}
for (const el of all.elements) {
  const b = el.bounds;
  const center = b ? `${((b.minlat + b.maxlat) / 2).toFixed(5)}, ${((b.minlon + b.maxlon) / 2).toFixed(5)}` : '?';
  console.log(`  - ${el.tags?.name || '(no name)'}  [${el.type}/${el.id}] at ${center}`);
}

// Unnamed courses: how many holes, total par and the address tags, to tell them apart.
for (const el of all.elements.filter(e => !e.tags?.name)) {
  const b = el.bounds;
  const box = `${b.minlat},${b.minlon},${b.maxlat},${b.maxlon}`;
  try {
    const holes = await rawOverpass(`[out:json][timeout:25];way["golf"="hole"](${box});out tags;`);
    const par = holes.elements.reduce((sum, h) => sum + (parseInt(h.tags.par, 10) || 0), 0);
    console.log(`  ${el.type}/${el.id}: ${holes.elements.length} holes, par ${par}, tags ${JSON.stringify(el.tags)}`);
  } catch (e) {
    console.log(`  ${el.type}/${el.id}: couldn't check (${e.message})`);
  }
}

// Does Overpass let a web page (with an Origin header) read its answers?
for (const url of SERVERS) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Origin: 'https://juanpablohoyosc.github.io' },
      body: new URLSearchParams({ data: '[out:json];node(1);out;' }),
      signal: AbortSignal.timeout(30000),
    });
    console.log(`  CORS check ${new URL(url).hostname}: HTTP ${res.status}, allow-origin: ${res.headers.get('access-control-allow-origin') || 'none'}`);
  } catch (e) {
    console.log(`  CORS check ${new URL(url).hostname}: ${e.message}`);
  }
}

// A preset that fails this time keeps the file from the last good run.
let previous = [];
try { previous = JSON.parse(await readFile(new URL('index.json', outDir), 'utf8')); } catch { /* first run */ }
const index = [];
for (const preset of PRESETS.filter(p => !p.unmapped)) {
  const keepOld = () => {
    const old = previous.find(e => e.preset === preset.name);
    if (old) { index.push(old); console.log(`  keeping the saved copy (${old.file})`); }
  };
  console.log(`\n=== ${preset.label}`);
  try {
    const found = await findCoursesByName(preset.name);
    if (!found.length) { console.log('  not found by name'); keepOld(); continue; }
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
    keepOld();
  }
}

await writeFile(new URL('index.json', outDir), JSON.stringify(index, null, 2) + '\n');
console.log(`\nSaved ${index.length} course file(s).`);
