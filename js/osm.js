// Real course data from OpenStreetMap, fetched in the browser through the free
// Overpass API (no key). Volunteers map golf holes as a line from tee to green
// (golf=hole, with ref = hole number and par), and greens as outlines
// (golf=green). T2G turns those into front/center/back points. Nothing is
// typed in by hand, so a course is only as good as its OpenStreetMap mapping.

import { centroid, pointInRing, haversine, lineThroughRing } from './geo.js';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

export const ATTRIBUTION = 'Course data © OpenStreetMap contributors (ODbL)';

// Northwest Arkansas: Fayetteville, Johnson, Springdale, Rogers, Bentonville.
const NWA_BBOX = '35.95,-94.45,36.45,-93.95';

export const PRESETS = [
  { label: 'Lakeside Village Golf', place: 'Fayetteville, AR', name: 'Lakeside Village' },
  { label: 'The Links at Fayetteville', place: 'Fayetteville, AR', name: 'Links at Fayetteville' },
  { label: 'Blessings Golf Club', place: 'Johnson, AR', name: 'Blessings' },
];

async function overpass(query) {
  for (const url of ENDPOINTS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
        signal: ctrl.signal,
      });
      if (res.ok) return await res.json();
    } catch {
      // busy, rate-limited or offline: try the next mirror
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('Couldn’t reach OpenStreetMap. Check your connection and try again.');
}

const round = n => Math.round(n * 1e6) / 1e6;
const toPoints = geom => (geom || []).filter(Boolean).map(g => [round(g.lat), round(g.lon)]);
const same = (a, b) => a[0] === b[0] && a[1] === b[1];

function toSummary(el) {
  const b = el.bounds;
  return {
    type: el.type,
    id: el.id,
    name: el.tags?.name || 'Unnamed golf course',
    bounds: b,
    center: b ? [(b.minlat + b.maxlat) / 2, (b.minlon + b.maxlon) / 2] : null,
  };
}

function courseQuery(filter) {
  return `[out:json][timeout:25];(way["leisure"="golf_course"]${filter};relation["leisure"="golf_course"]${filter};);out tags bb;`;
}

export async function findCoursesByName(name) {
  const safe = name.replace(/[^\p{L}\p{N} '&-]/gu, '');
  const data = await overpass(courseQuery(`["name"~"${safe}",i](${NWA_BBOX})`));
  return data.elements.map(toSummary);
}

export async function findCoursesNear(point, radiusMeters = 25000) {
  const data = await overpass(courseQuery(`(around:${radiusMeters},${point[0]},${point[1]})`));
  return data.elements
    .map(toSummary)
    .filter(c => c.center)
    .sort((a, b) => haversine(point, a.center) - haversine(point, b.center));
}

// Stitch outline pieces (a closed way, or a multipolygon's member ways) into rings.
function joinRings(lines) {
  const rest = lines.filter(l => l.length >= 2).map(l => l.slice());
  const rings = [];
  while (rest.length) {
    let ring = rest.shift();
    let grew = true;
    while (!same(ring[0], ring[ring.length - 1]) && grew) {
      grew = false;
      for (let i = 0; i < rest.length; i++) {
        const l = rest[i];
        const end = ring[ring.length - 1];
        if (same(end, l[0])) ring = ring.concat(l.slice(1));
        else if (same(end, l[l.length - 1])) ring = ring.concat(l.slice(0, -1).reverse());
        else continue;
        rest.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (ring.length >= 4 && same(ring[0], ring[ring.length - 1])) rings.push(ring.slice(0, -1));
  }
  return rings;
}

function ringsOf(el) {
  if (el.type === 'way') return joinRings([toPoints(el.geometry)]);
  if (el.type === 'relation') {
    return joinRings((el.members || [])
      .filter(m => m.type === 'way' && m.role !== 'inner')
      .map(m => toPoints(m.geometry)));
  }
  return [];
}

export async function loadCourse(summary) {
  const b = summary.bounds;
  if (!b) throw new Error(`OpenStreetMap didn’t return an outline for “${summary.name}”.`);
  const pad = 0.0015;
  const bbox = `${b.minlat - pad},${b.minlon - pad},${b.maxlat + pad},${b.maxlon + pad}`;
  const data = await overpass(
    `[out:json][timeout:60];${summary.type}(${summary.id});out geom;` +
    `(way["golf"](${bbox});relation["golf"](${bbox});` +
    `way["natural"="water"](${bbox});relation["natural"="water"](${bbox}););out geom;`,
  );

  const els = data.elements;
  const courseEl = els.find(e => e.type === summary.type && e.id === summary.id);
  const outline = courseEl ? ringsOf(courseEl) : [];
  const inCourse = p => outline.length === 0 || outline.some(r => pointInRing(p, r));
  const golf = v => els.filter(e => e.tags?.golf === v);

  const greens = golf('green').flatMap(ringsOf).map(ring => ({ ring, center: centroid(ring) }));
  const greenAt = p =>
    greens.find(g => pointInRing(p, g.ring)) ||
    greens
      .filter(g => haversine(p, g.center) < 50)
      .sort((x, y) => haversine(p, x.center) - haversine(p, y.center))[0] ||
    null;

  const report = { unnumbered: 0, duplicates: 0, withoutGreen: 0, withoutPar: 0 };
  const byNumber = new Map();

  for (const el of golf('hole')) {
    if (el.type !== 'way') continue;
    let path = toPoints(el.geometry);
    if (path.length < 2) continue;
    const number = parseInt(el.tags.ref, 10);
    if (!number) { report.unnumbered++; continue; }

    // Holes are mapped tee -> green; flip the odd one drawn backwards.
    const startsOnGreen = greens.some(g => pointInRing(path[0], g.ring));
    const endsOnGreen = greens.some(g => pointInRing(path[path.length - 1], g.ring));
    if (startsOnGreen && !endsOnGreen) path = path.reverse();

    const end = path[path.length - 1];
    if (!inCourse(end) && !inCourse(path[0])) continue;
    if (byNumber.has(number)) { report.duplicates++; continue; }

    const green = greenAt(end);
    const center = green ? green.center.map(round) : end;
    let front = null, back = null;
    if (green) {
      // Approach from the last point of the line of play that's off the green.
      const approach = [...path].reverse().find(p => !pointInRing(p, green.ring)) || path[0];
      const cut = lineThroughRing(approach, center, green.ring);
      if (cut) { front = cut.front.map(round); back = cut.back.map(round); }
    } else {
      report.withoutGreen++;
    }

    const par = parseInt(el.tags.par, 10);
    const validPar = par >= 3 && par <= 6 ? par : null;
    if (!validPar) report.withoutPar++;

    byNumber.set(number, {
      number,
      par: validPar,
      tee: path[0],
      path,
      green: { front, center, back },
      greenOutline: green ? green.ring : null,
    });
  }

  const holes = [...byNumber.values()].sort((a, b) => a.number - b.number);
  if (holes.length === 0) {
    throw new Error(
      `OpenStreetMap has “${summary.name}”, but none of its holes are mapped yet, so there’s nothing to measure. ` +
      'You’ll be able to add it yourself with the course builder.',
    );
  }

  const hazards = [];
  for (const el of els) {
    const t = el.tags || {};
    const kind = t.golf === 'bunker' ? 'bunker'
      : (t.golf === 'water_hazard' || t.golf === 'lateral_water_hazard' || t.natural === 'water') ? 'water'
      : null;
    if (!kind) continue;
    for (const ring of ringsOf(el)) {
      if (inCourse(centroid(ring))) hazards.push({ kind, outline: ring });
    }
  }

  const course = {
    id: `osm-${summary.type}-${summary.id}`,
    name: summary.name,
    source: 'openstreetmap',
    attribution: ATTRIBUTION,
    osm: { type: summary.type, id: summary.id },
    fetchedAt: new Date().toISOString(),
    holes,
    hazards,
  };
  return { course, report };
}
