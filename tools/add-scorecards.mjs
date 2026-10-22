// Adds club scorecards from OpenGolfAPI (opengolfapi.org: free, no key,
// ODbL) to the course catalog in data/courses/:
//
//  - courses mapped on OpenStreetMap get par (where it's missing), handicap
//    and yardage per tee, but only when OpenGolfAPI has the same number of holes
//  - courses OpenStreetMap doesn't have holes for are added as "scorecard"
//    courses (par, handicap, yardages, location; no green positions), or as
//    "location" courses when there's no usable scorecard
//
// OpenGolfAPI has no green positions of its own, so hole geometry still comes
// only from OpenStreetMap. Runs on GitHub Actions after fetch-courses.mjs.

import { readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const API = 'https://api.opengolfapi.org/api/v1';
const HEADERS = { 'User-Agent': 'T2G course fetcher (github.com/Juanpablohoyosc/T2G)' };
const CREDIT = 'Scorecards: OpenGolfAPI (ODbL)';

// Same region as fetch-courses.mjs.
const REGION = { south: 35.95, west: -94.45, north: 36.5, east: -93.95 };
const MATCH_METERS = 2500;

const GENERIC = new Set(['golf', 'course', 'courses', 'club', 'country', 'the', 'at', 'and', 'of', 'athletic', 'cc', 'gc', 'executive']);
export const nameTokens = name => new Set(
  (name || '').toLowerCase().replace(/&/g, ' ').split(/[^a-z0-9]+/).filter(t => t && !GENERIC.has(t)),
);
const overlap = (a, b) => [...a].filter(t => b.has(t)).length;

export function meters(a, b) {
  const rad = Math.PI / 180;
  const h = Math.sin((b[0] - a[0]) * rad / 2) ** 2 +
    Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin((b[1] - a[1]) * rad / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
}

// The OpenGolfAPI course that is the same place as a catalog course: nearby,
// sharing a distinctive word in the name, preferring the same hole count.
export function bestMatch(entry, candidates, holeCount = null) {
  const mine = nameTokens(entry.name);
  return candidates
    .map(c => ({ c, d: meters(entry.center, [c.lat, c.lng]), o: overlap(mine, nameTokens(c.name)) }))
    .filter(x => x.d <= MATCH_METERS && x.o > 0)
    .sort((x, y) =>
      (holeCount != null ? (y.c.holes === holeCount) - (x.c.holes === holeCount) : 0) ||
      y.o - x.o || x.d - y.d)[0]?.c || null;
}

const TEE_RANGE = [40, 720];

// Real courses: 9 holes par 27-37, 18 holes par 54-74.
const PAR_RANGE = { 9: [27, 37], 18: [54, 74] };

// A scorecard T2G can trust: every hole numbered 1..n once, par 3-6, and a
// believable total (one source card had twelve par 5s in a row).
// Handicaps are kept only if they're a clean 1..n set; a tee's yardages only
// if every hole has one.
export function cleanScorecard(holes) {
  if (!Array.isArray(holes) || ![9, 18].includes(holes.length)) return null;
  const sorted = [...holes].sort((a, b) => a.number - b.number);
  if (sorted.some((h, i) => h.number !== i + 1 || !(h.par >= 3 && h.par <= 6))) return null;
  const total = sorted.reduce((s, h) => s + h.par, 0);
  const [lo, hi] = PAR_RANGE[sorted.length];
  if (total < lo || total > hi) return null;

  const hcps = sorted.map(h => h.handicap_index);
  const hcpOk = hcps.every(n => Number.isInteger(n) && n >= 1 && n <= 18) && new Set(hcps).size === hcps.length;

  // "web" is a source artifact in OpenGolfAPI, not a tee anyone plays from.
  const teeNames = Object.keys(sorted[0].yardages || {}).filter(t => !/^web$/i.test(t));
  const tees = teeNames.filter(t => sorted.every(h => {
    const y = h.yardages?.[t];
    return Number.isFinite(y) && y >= TEE_RANGE[0] && y <= TEE_RANGE[1];
  }));

  return sorted.map(h => ({
    number: h.number,
    par: h.par,
    handicap: hcpOk ? h.handicap_index : null,
    yardages: tees.length ? Object.fromEntries(tees.map(t => [label(t), h.yardages[t]])) : null,
  }));
}

const label = t => t.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

// Tee sets with their total length, longest first.
export function teeList(card) {
  const names = Object.keys(card[0].yardages || {});
  return names
    .map(name => ({ name, yards: card.reduce((s, h) => s + h.yardages[name], 0) }))
    .sort((a, b) => b.yards - a.yards);
}

// Take a course back to what OpenStreetMap alone says, so every run starts
// clean and a scorecard that no longer passes leaves nothing behind.
export function stripScorecard(course) {
  for (const hole of course.holes) {
    if (hole.parFrom === 'scorecard') hole.par = null;
    delete hole.parFrom;
    delete hole.handicap;
    delete hole.yardages;
  }
  delete course.tees;
  delete course.scorecard;
  course.attribution = course.attribution.replace(` · ${CREDIT}`, '');
  return course;
}

// Merge a clean scorecard into an OpenStreetMap course. OpenStreetMap's par
// wins where both have one; differences are reported.
export function applyScorecard(course, card, ogaId) {
  const notes = [];
  stripScorecard(course);
  for (const hole of course.holes) {
    const s = card[hole.number - 1];
    if (hole.par == null) { hole.par = s.par; hole.parFrom = 'scorecard'; }
    else if (hole.par !== s.par) notes.push(`hole ${hole.number}: OpenStreetMap par ${hole.par}, scorecard par ${s.par}`);
    hole.handicap = s.handicap;
    hole.yardages = s.yardages;
  }
  course.tees = card[0].yardages ? teeList(card) : [];
  course.scorecard = { source: 'OpenGolfAPI', id: ogaId };
  if (!course.attribution.includes(CREDIT)) course.attribution += ` · ${CREDIT}`;
  return notes;
}

// A course OpenStreetMap has no holes for: scorecard and location only.
export function scorecardCourse(oga, card) {
  return {
    id: `oga-${oga.id}`,
    name: oga.name,
    source: 'opengolfapi',
    attribution: `Course data © OpenStreetMap contributors (ODbL) · ${CREDIT}`,
    scorecard: { source: 'OpenGolfAPI', id: oga.id },
    center: [oga.lat, oga.lng],
    tees: card[0].yardages ? teeList(card) : [],
    holes: card.map(s => ({
      number: s.number, par: s.par, handicap: s.handicap, yardages: s.yardages,
      tee: null, path: null, green: null, greenOutline: null,
    })),
    hazards: [],
  };
}

// A short fingerprint of each course file, so the app can tell when a course
// it saved on the phone has newer data here and refresh its copy.
export async function stampVersions(catalog, outDir) {
  for (const e of catalog) {
    if (!e.file) { delete e.v; continue; }
    const body = await readFile(new URL(e.file, outDir));
    e.v = createHash('sha1').update(body).digest('hex').slice(0, 10);
  }
}

async function api(path) {
  const res = await fetch(`${API}${path}`, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return res.json();
}

const list = data => (Array.isArray(data) ? data : data.courses || data.results || data.data || []);
// "Links At Lowell The" -> "The Links At Lowell"
const tidyName = n => (n || '').replace(/^(.*?),? The$/, 'The $1');
const normalize = c => ({
  id: c.id,
  name: tidyName(c.name || c.course_name),
  lat: c.latitude ?? c.lat,
  lng: c.longitude ?? c.lng,
  holes: c.holes,
});

async function main() {
  const outDir = new URL('../data/courses/', import.meta.url);
  // Start from the OpenStreetMap part of the catalog. What this script added
  // last time is rebuilt from scratch, so running it again is always safe.
  const catalog = JSON.parse(await readFile(new URL('catalog.json', outDir), 'utf8'))
    .filter(e => e.osm)
    .map(({ oga, kind, scorecard, ...e }) => (e.file?.startsWith('oga-') ? { ...e, file: null, holes: 0 } : e));
  const inRegion = c => c.lat >= REGION.south && c.lat <= REGION.north && c.lng >= REGION.west && c.lng <= REGION.east;

  let oga;
  try {
    const byId = new Map();
    const state = await api('/courses/state/AR');
    console.log(`state/AR: ${list(state).length} courses; keys ${Object.keys(state).join(',')}`);
    for (const c of list(state)) byId.set(c.id, normalize(c));
    const near = await api('/courses/search?lat=36.25&lng=-94.2&radius_mi=40&limit=200');
    console.log(`radius search: ${list(near).length} courses`);
    for (const c of list(near)) byId.set(c.id, normalize(c));
    oga = [...byId.values()].filter(c =>
      c.id && c.name && Number.isFinite(c.lat) && inRegion(c) && !/disc|mini|putt|driving range|foot ?golf/i.test(c.name));
  } catch (e) {
    console.log(`OpenGolfAPI unavailable (${e.message}); catalog left as it is.`);
    return;
  }
  console.log(`${oga.length} OpenGolfAPI courses in the region`);

  const cards = new Map();
  const cardFor = async c => {
    if (!cards.has(c.id)) {
      try {
        cards.set(c.id, cleanScorecard((await api(`/courses/${c.id}/holes`)).holes));
      } catch (e) {
        console.log(`  ${c.name}: ${e.message}`);
        cards.set(c.id, null);
      }
    }
    return cards.get(c.id);
  };

  const used = new Set();

  // 1. Enrich courses mapped on OpenStreetMap.
  for (const entry of catalog) {
    const hit = bestMatch(entry, oga, entry.file ? entry.holes : null);
    if (!hit) { console.log(`\n${entry.name}: no OpenGolfAPI match`); continue; }
    used.add(hit.id);
    for (const c of oga) if (bestMatch(entry, [c])) used.add(c.id); // its duplicates too
    entry.oga = hit.id;
    console.log(`\n${entry.name} ↔ ${hit.name} (${Math.round(meters(entry.center, [hit.lat, hit.lng]))} m)`);
    if (!entry.file) continue;

    const card = await cardFor(hit);
    const course = JSON.parse(await readFile(new URL(entry.file, outDir), 'utf8'));
    if (!card || card.length !== course.holes.length) {
      console.log(`  scorecard not used: ${card ? `${card.length} holes vs ${course.holes.length}` : 'missing or inconsistent'}`);
      await writeFile(new URL(entry.file, outDir), JSON.stringify(stripScorecard(course)));
      continue;
    }
    const notes = applyScorecard(course, card, hit.id);
    course.center = entry.center;
    notes.forEach(n => console.log(`  ${n}`));
    console.log(`  par ${course.holes.reduce((s, h) => s + h.par, 0)}; tees ${course.tees.map(t => `${t.name} ${t.yards}`).join(', ') || 'none'}; handicaps ${course.holes[0].handicap ? 'yes' : 'no'}`);
    if (course.tees.length) {
      const longest = course.tees[0].name;
      const check = course.holes.map(h => `${h.number}:${h.yardages[longest]}/` +
        (h.tee && h.green?.center ? Math.round(meters(h.tee, h.green.center) / 0.9144) : '?'));
      console.log(`  ${longest} card vs mapped tee-to-center: ${check.join(' ')}`);
    }
    await writeFile(new URL(entry.file, outDir), JSON.stringify(course));
    entry.scorecard = true;
  }

  // 2. Courses only OpenGolfAPI knows, or that OpenStreetMap has without holes.
  for (const entry of catalog.filter(e => !e.file && e.oga)) {
    const hit = oga.find(c => c.id === entry.oga);
    const card = await cardFor(hit);
    if (!card) { entry.kind = 'location'; continue; }
    const course = scorecardCourse(hit, card);
    entry.file = `${course.id}.json`;
    entry.holes = card.length;
    entry.kind = 'scorecard';
    entry.scorecard = true;
    await writeFile(new URL(entry.file, outDir), JSON.stringify(course));
    console.log(`\n${entry.name}: scorecard course, ${card.length} holes, par ${card.reduce((s, h) => s + h.par, 0)}`);
  }
  for (const c of oga) {
    if (used.has(c.id)) continue;
    const dupes = [c, ...oga.filter(o => o !== c && !used.has(o.id) && bestMatch({ name: c.name, center: [c.lat, c.lng] }, [o]))];
    dupes.forEach(o => used.add(o.id));
    let pick = null, card = null;
    for (const o of dupes) {
      const oc = await cardFor(o);
      if (oc && !card) { pick = o; card = oc; }
    }
    pick ||= c;
    const entry = { osm: null, oga: pick.id, name: pick.name, center: [pick.lat, pick.lng], holes: 0, file: null };
    if (card) {
      const course = scorecardCourse(pick, card);
      Object.assign(entry, { file: `${course.id}.json`, holes: card.length, kind: 'scorecard', scorecard: true });
      await writeFile(new URL(entry.file, outDir), JSON.stringify(course));
    } else {
      entry.kind = 'location';
    }
    catalog.push(entry);
    console.log(`\nadded ${entry.name} (${entry.kind}${card ? `, ${card.length} holes` : ''})${dupes.length > 1 ? `; same place as ${dupes.filter(o => o !== pick).map(o => o.name).join(', ')}` : ''}`);
  }

  for (const e of catalog) e.kind ||= e.file ? 'mapped' : 'location';

  // Scorecard files from earlier runs that no longer pass.
  const keep = new Set(catalog.map(e => e.file));
  for (const f of await readdir(outDir)) {
    if (f.startsWith('oga-') && !keep.has(f)) { await unlink(new URL(f, outDir)); console.log(`removed ${f}`); }
  }
  await stampVersions(catalog, outDir);
  catalog.sort((a, b) => a.name.localeCompare(b.name));
  await writeFile(new URL('catalog.json', outDir), JSON.stringify(catalog, null, 2) + '\n');
  const count = k => catalog.filter(e => e.kind === k).length;
  console.log(`\nCatalog: ${catalog.length} courses: ${count('mapped')} mapped, ${count('scorecard')} scorecard only, ${count('location')} location only; ${catalog.filter(e => e.scorecard).length} with scorecards.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
