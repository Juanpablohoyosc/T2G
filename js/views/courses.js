// Course picker sheet: saved courses, the Fayetteville presets and
// "near me" search, all loaded from OpenStreetMap.

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

  $('preset-list').replaceChildren(...PRESETS.map(p =>
    row(p.label, p.place, () => run(() => loadPreset(p)))));

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

async function loadPreset(preset) {
  setMsg(`Searching OpenStreetMap for ${preset.label}…`, { waiting: true });
  const found = await findCoursesByName(preset.name);
  if (found.length === 0) {
    setMsg(`${preset.label} isn’t on OpenStreetMap as a golf course yet.`, { error: true });
    return;
  }
  const wanted = preset.name.toLowerCase();
  const best = found.find(c => c.name.toLowerCase().includes(wanted)) || found[0];
  await loadAndSave(best);
}

async function searchNearMe() {
  setMsg('Getting your location…', { waiting: true });
  const point = loc.snapshot().position?.point || await currentPoint();
  setMsg('Searching OpenStreetMap for nearby courses…', { waiting: true });
  const found = (await findCoursesNear(point)).slice(0, 12);
  if (found.length === 0) {
    setMsg('No golf courses mapped within 25 km.', { error: true });
    return;
  }
  setMsg('');
  $('near-list').replaceChildren(...found.map(c => {
    const miles = haversine(point, c.center) / 1609.344;
    return row(c.name, `${miles.toFixed(1)} mi away`, () => run(() => loadAndSave(c)));
  }));
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
  const { course, report } = await loadCourse(summary);
  if (!saveCourse(course)) {
    throw new Error('This phone’s storage for T2G is full. Delete a course and try again.');
  }
  forgetCachedCourse();
  setState({ courseId: course.id, holeIndex: 0 });
  $('course-sheet').close();
  toast(describe(course, report));
}

function describe(course, report) {
  const parts = [`Loaded ${course.name}: ${course.holes.length} holes.`];
  if (report.withoutGreen) parts.push(`${report.withoutGreen} without a mapped green show center only.`);
  if (report.withoutPar) parts.push(`Par isn’t mapped for ${report.withoutPar}.`);
  return parts.join(' ');
}
