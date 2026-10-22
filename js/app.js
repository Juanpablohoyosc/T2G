// T2G startup: theme, settings sheet, GPS vs. demo mode, wake lock.

import { state, setState, onState, currentCourse, currentTee, setTee } from './state.js';
import * as loc from './location.js';
import { setWakeLock, wakeLockSupported } from './wakelock.js';
import * as demo from './demo.js';
import { initDistanceView } from './views/distance.js';
import { initMapView, showMap, hideMap, focusOn } from './views/map.js';
import { initCourseSheet, openCourseSheet, openNearMe, catalogSize, refreshSavedCourses } from './views/courses.js';
import { initHome } from './views/home.js';

const $ = id => document.getElementById(id);

function applyTheme() {
  const sun = state.theme === 'sun';
  document.documentElement.dataset.theme = state.theme;
  document.querySelector('meta[name="theme-color"]').content = sun ? '#ffffff' : '#0a0c0b';
  $('theme-btn').setAttribute('aria-label', sun ? 'Switch to dark mode' : 'Switch to sun mode');
}

function applyMode() {
  demo.stopWalk();
  if (state.demo) loc.startDemo(demo.startPoint());
  else loc.startGps();
  $('app').classList.toggle('demo', state.demo);
  $('demo-banner').hidden = !state.demo;
}

function syncSettingsSheet() {
  document.querySelectorAll('[data-units]').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.units === state.units)));
  document.querySelectorAll('[data-theme-choice]').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.themeChoice === state.theme)));
  $('demo-toggle').checked = state.demo;

  // Tee choice, for courses with a scorecard.
  const tees = currentCourse()?.tees || [];
  $('tee-setting').hidden = !tees.length;
  const select = $('tee-select');
  select.replaceChildren(...tees.map(t => new Option(`${t.name} · ${t.yards.toLocaleString('en-US')} yd`, t.name)));
  select.value = currentTee() || '';
  $('wake-toggle').checked = state.keepAwake && wakeLockSupported;
}

let toastTimer;
function showToast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 6000);
}

function initSheets() {
  // Tap outside a sheet, or its close button, to dismiss it.
  document.querySelectorAll('dialog.sheet').forEach(d => {
    d.addEventListener('click', e => {
      if (e.target === d || e.target.closest('[data-close]')) d.close();
    });
  });

  $('course-btn').addEventListener('click', openCourseSheet);
  $('settings-btn').addEventListener('click', openSettings);
  $('theme-btn').addEventListener('click', () =>
    setState({ theme: state.theme === 'sun' ? 'dark' : 'sun' }));

  document.querySelectorAll('[data-units]').forEach(b =>
    b.addEventListener('click', () => setState({ units: b.dataset.units })));
  document.querySelectorAll('[data-theme-choice]').forEach(b =>
    b.addEventListener('click', () => setState({ theme: b.dataset.themeChoice })));
  $('demo-toggle').addEventListener('change', e => setState({ demo: e.target.checked }));
  $('wake-toggle').addEventListener('change', e => setState({ keepAwake: e.target.checked }));
  $('tee-select').addEventListener('change', e => setTee(e.target.value));

  if (!wakeLockSupported) {
    $('wake-toggle').disabled = true;
    $('wake-help').textContent = 'This browser can’t keep the screen on. Raise auto-lock in your phone’s settings instead.';
  }
}

// Screens: Home (start menu), the yardage screen and the satellite map.
function showTab(tab) {
  document.querySelectorAll('.tabbar [data-tab]').forEach(b => {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  $('home-view').hidden = tab !== 'home';
  $('gps-view').hidden = tab !== 'gps';
  $('map-view').hidden = tab !== 'map';
  $('app').dataset.tab = tab;
  document.documentElement.dataset.tab = tab;
  if (tab === 'map') showMap();
  else hideMap();
}

// Open the map on a spot (a course with no hole data); in demo mode the
// simulated player goes there too.
function showMapAt(point) {
  focusOn(point, 16);
  if (state.demo) demo.placeAtPoint(point);
  showTab('map');
}

function openSettings() {
  syncSettingsSheet();
  $('settings-sheet').showModal();
}

initSheets();
initCourseSheet({ showToast, showMapAt, showYardageView: () => showTab('gps') });
initHome({ showTab, openCourses: openCourseSheet, openNearMe, catalogSize });
initDistanceView({ openCourses: openCourseSheet, openSettings });
initMapView();
document.querySelectorAll('.tabbar [data-tab]').forEach(b =>
  b.addEventListener('click', () => showTab(b.dataset.tab)));

onState(patch => {
  // A new hole or course puts the demo player back on its tee, or in the
  // middle of a course that only has a scorecard.
  if (state.demo && ('courseId' in patch || 'holeIndex' in patch)) {
    if (demo.startPoint()) demo.resetToTee();
    else if ('courseId' in patch && currentCourse()?.center) demo.placeAtPoint(currentCourse().center);
  }
  if ('theme' in patch) applyTheme();
  if ('demo' in patch) applyMode();
  if ('keepAwake' in patch) setWakeLock(state.keepAwake);
  syncSettingsSheet();
});

// Open on Home, unless a round was going on in the last few hours: then
// straight back to the yardages.
const ROUND_GAP_MS = 4 * 60 * 60 * 1000;
const noteLastSeen = () => setState({ lastSeen: Date.now() });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') noteLastSeen(); });
window.addEventListener('pagehide', noteLastSeen);

applyTheme();
applyMode();
showTab(state.courseId && Date.now() - state.lastSeen < ROUND_GAP_MS ? 'gps' : 'home');
refreshSavedCourses();
setWakeLock(state.keepAwake);
