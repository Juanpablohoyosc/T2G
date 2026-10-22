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

import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

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

// A scorecard T2G can trust: every hole numbered 1..n once, par 3-6.
// Handicaps are kept only if they're a clean 1..n set; a tee's yardages only
// if every hole has one.
export function cleanScorecard(holes) {
  if (!Array.isArray(holes) || ![9, 18].includes(holes.length)) return null;
  const sorted = [...holes].sort((a, b) => a.number - b.number);
  if (sorted.some((h, i) => h.number !== i + 1 || !(h.par >= 3 && h.par <= 6))) return null;

  const hcps = sorted.map(h => h.handicap_index);
  const hcpOk = hcps.every(n => Number.isInteger(n) && n >= 1 && n <= 18) && new Set(hcps).size === hcps.length;

  const teeNames = Object.keys(sorted[0].yardages || {});
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

// Merge a clean scorecard into an OpenStreetMap course. OpenStreetMap's par
// wins where both have one; differences are reported.
export function applyScorecard(course, card, ogaId) {
  const notes = [];
  for (const hole of course.holes) {
    const s = card[hole.number - 1];
    if (hole.par == null) hole.par = s.par;
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

async function api(path) {
  const res = await fetch(`${API}${path}`, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return res.json();
}

const list = data => (Array.isArray(data) ? data : data.courses || data.results || data.data || []);
const normalize = c => ({
  id: c.id,
  name: c.name || c.course_name,
  lat: c.latitude ?? c.lat,
  lng: c.longitude ?? c.lng,
  holes: c.holes,
});

async function main() {
  const outDir = new URL('../data/courses/', import.meta.url);
  const catalog = JSON.parse(await readFile(new URL('catalog.json', outDir), 'utf8'));
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
      continue;
    }
    const notes = applyScorecard(course, card, hit.id);
    course.center = entry.center;
    notes.forEach(n => console.log(`  ${n}`));
    console.log(`  par ${course.holes.reduce((s, h) => s + h.par, 0)}; tees ${course.tees.map(t => `${t.name} ${t.yards}`).join(', ') || 'none'}; handicaps ${course.holes[0].handicap ? 'yes' : 'no'}`);
    if (course.tees.length) {
      const longest = course.tees[0].name;
      const check = course.holes.map(h => `${h.number}:${h.yardages[longest]}/${Math.round(meters(h.tee, h.green.center) / 0.9144)}`);
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
  catalog.sort((a, b) => a.name.localeCompare(b.name));
  await writeFile(new URL('catalog.json', outDir), JSON.stringify(catalog, null, 2) + '\n');
  const count = k => catalog.filter(e => e.kind === k).length;
  console.log(`\nCatalog: ${catalog.length} courses: ${count('mapped')} mapped, ${count('scorecard')} scorecard only, ${count('location')} location only; ${catalog.filter(e => e.scorecard).length} with scorecards.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
