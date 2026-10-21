// Course picker sheet: saved courses, the Fayetteville presets and
// "near me", from the bundled OpenStreetMap catalog (or a live search).

import { state, setState, forgetCachedCourse } from '../state.js';
import { listCourses, saveCourse, deleteCourse } from '../courses.js';
import { PRESETS, findCoursesByName, findCoursesNear, loadCourse } from '../osm.js';
import { haversine } from '../geo.js';
import * as loc from '../location.js';

const $ = id => document.getElementById(id);
let busy = false;
let toast = () => {};

export function initCourseSheet({ showToast }) {
  toast = showToast;
  const sheet = $('course-sheet');

  $('preset-list').replaceChildren(...PRESETS.map(p => p.unmapped
    ? row(p.label, `${p.place} · not on OpenStreetMap yet`, () => setMsg(
      `${p.label} hasn’t been mapped on OpenStreetMap, so there’s no hole data to load. You’ll be able to add it yourself with the course builder.`,
      { error: true }))
    : row(p.label, p.place, () => run(() => loadPreset(p)))));

  $('near-btn').addEventListener('click', () => run(searchNearMe));
  sheet.addEventListener('close', () => { $('near-list').replaceChildren(); setMsg(''); });
}

export function openCourseSheet() {
  renderSaved();
  $('course-sheet').showModal();
}

function row(title, sub, onClick, side) {
  const li = document.createElement('li');
  li.className = 'row';
  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'row-main';
  const t = document.createElement('span');
  t.className = 'row-title';
  t.textContent = title;
  const s = document.createElement('span');
  s.className = 'row-sub';
  s.textContent = sub;
  main.append(t, s);
  main.addEventListener('click', onClick);
  li.append(main);
  if (side) li.append(side);
  return li;
}

function renderSaved() {
  const courses = listCourses();
  $('saved-empty').hidden = courses.length > 0;
  $('saved-list').replaceChildren(...courses.map(c => {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'row-side';
    del.setAttribute('aria-label', `Delete ${c.name}`);
    del.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>';
    del.addEventListener('click', () => {
      if (!confirm(`Delete ${c.name} from this phone?`)) return;
      deleteCourse(c.id);
      if (state.courseId === c.id) { forgetCachedCourse(); setState({ courseId: null, holeIndex: 0 }); }
      renderSaved();
    });
    const source = c.source === 'openstreetmap' ? 'OpenStreetMap' : 'My course';
    const li = row(c.name, `${c.holes.length} holes · ${source}`, () => {
      forgetCachedCourse();
      setState({ courseId: c.id, holeIndex: 0 });
      $('course-sheet').close();
    }, del);
    li.classList.toggle('active', c.id === state.courseId);
    return li;
  }));
}

let ticker = null;

// Status line under the course list. Waiting messages count the seconds after
// a moment, so a slow server never looks like a frozen app.
function setMsg(text, { error = false, waiting = false } = {}) {
  clearInterval(ticker);
  const m = $('load-msg');
  m.textContent = text;
  m.classList.toggle('error', error);
  if (!waiting) return;
  const started = Date.now();
  ticker = setInterval(() => {
    const s = Math.round((Date.now() - started) / 1000);
    if (s >= 4) m.textContent = `${text} ${s} s`;
  }, 1000);
}

// One OpenStreetMap request at a time; buttons are disabled while it runs.
async function run(task) {
  if (busy) return;
  busy = true;
  const buttons = $('course-sheet').querySelectorAll('.row-main, #near-btn');
  buttons.forEach(b => { b.disabled = true; });
  try {
    await task();
  } catch (e) {
    setMsg(e.message || 'Something went wrong. Try again.', { error: true });
  } finally {
    busy = false;
    buttons.forEach(b => { b.disabled = false; });
  }
}

// The catalog ships with the app (data/courses/catalog.json, built ahead of
// time from OpenStreetMap by a GitHub Action): every course mapped in the
// region, plus full hole data for the ones that have holes. Reading it is
// instant and doesn't depend on OpenStreetMap's busy public servers.
let catalog = null;

async function loadCatalog() {
  if (catalog) return catalog;
  try {
    const res = await fetch('data/courses/catalog.json', { cache: 'no-cache' });
    const list = await res.json();
    if (Array.isArray(list)) catalog = list;
  } catch {
    // offline before the catalog was ever cached: fall back to a live search
  }
  return catalog || [];
}

async function openCatalogCourse(entry) {
  if (!entry.file) {
    setMsg(`${entry.name} is on OpenStreetMap, but its holes aren’t mapped yet, so there’s nothing to measure. You’ll be able to add it with the course builder.`, { error: true });
    return;
  }
  setMsg(`Opening ${entry.name}…`, { waiting: true });
  const res = await fetch(`data/courses/${entry.file}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Couldn’t open ${entry.name}. Check your connection and try again.`);
  play(await res.json());
}

async function loadPreset(preset) {
  const wanted = preset.name.toLowerCase();
  const entry = (await loadCatalog()).find(e => e.file && e.name.toLowerCase().includes(wanted));
  if (entry) {
    await openCatalogCourse(entry);
    return;
  }
  setMsg(`Searching OpenStreetMap for ${preset.label}. The free servers can take a minute…`, { waiting: true });
  const found = await findCoursesByName(preset.name);
  if (found.length === 0) {
    setMsg(`${preset.label} isn’t on OpenStreetMap as a golf course yet.`, { error: true });
    return;
  }
  const best = found.find(c => c.name.toLowerCase().includes(wanted)) || found[0];
  await loadAndSave(best);
}

const NEARBY_METERS = 80000; // about 50 miles

async function searchNearMe() {
  setMsg('Getting your location…', { waiting: true });
  const point = loc.snapshot().position?.point || await currentPoint();
  const milesTo = c => haversine(point, c.center) / 1609.344;

  const nearby = (await loadCatalog())
    .filter(c => haversine(point, c.center) <= NEARBY_METERS)
    .sort((a, b) => milesTo(a) - milesTo(b))
    .slice(0, 15);

  if (nearby.length) {
    setMsg('');
    $('near-list').replaceChildren(...nearby.map(c => row(
      c.name,
      `${milesTo(c).toFixed(1)} mi · ${c.file ? `${c.holes} holes` : 'holes not mapped yet'}`,
      () => run(() => openCatalogCourse(c)),
    )));
    return;
  }

  // Outside the region T2G ships with: ask OpenStreetMap directly.
  setMsg('No saved courses near you, so searching OpenStreetMap live. The free servers can take a minute…', { waiting: true });
  const found = (await findCoursesNear(point)).slice(0, 12);
  if (found.length === 0) {
    setMsg('No golf courses mapped within 25 km.', { error: true });
    return;
  }
  setMsg('');
  $('near-list').replaceChildren(...found.map(c =>
    row(c.name, `${milesTo(c).toFixed(1)} mi away`, () => run(() => loadAndSave(c)))));
}

function currentPoint() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator) || !window.isSecureContext) {
      reject(new Error('Location isn’t available here. Use one of the courses above.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      p => resolve([p.coords.latitude, p.coords.longitude]),
      () => reject(new Error('Couldn’t get your location. Allow location for this site and try again.')),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
    );
  });
}

async function loadAndSave(summary) {
  setMsg(`Loading holes for ${summary.name}…`, { waiting: true });
  const { course } = await loadCourse(summary);
  play(course);
}

function play(course) {
  if (!saveCourse(course)) {
    throw new Error('This phone’s storage for T2G is full. Delete a course and try again.');
  }
  forgetCachedCourse();
  setState({ courseId: course.id, holeIndex: 0 });
  $('course-sheet').close();
  toast(describe(course));
}

function describe(course) {
  const withoutGreen = course.holes.filter(h => !h.greenOutline).length;
  const withoutPar = course.holes.filter(h => !h.par).length;
  const parts = [`Loaded ${course.name}: ${course.holes.length} holes.`];
  if (withoutGreen) parts.push(`${withoutGreen} without a mapped green show center only.`);
  if (withoutPar) parts.push(`Par isn’t mapped for ${withoutPar}.`);
  return parts.join(' ');
}
