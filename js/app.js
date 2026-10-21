// T2G startup: theme, settings sheet, GPS vs. demo mode, wake lock.

import { state, setState, onState } from './state.js';
import * as loc from './location.js';
import { setWakeLock, wakeLockSupported } from './wakelock.js';
import { initDistanceView, demoStartPoint } from './views/distance.js';
import { initCourseSheet, openCourseSheet } from './views/courses.js';

const $ = id => document.getElementById(id);

function applyTheme() {
  const sun = state.theme === 'sun';
  document.documentElement.dataset.theme = state.theme;
  document.querySelector('meta[name="theme-color"]').content = sun ? '#ffffff' : '#0a0c0b';
  $('theme-btn').setAttribute('aria-label', sun ? 'Switch to dark mode' : 'Switch to sun mode');
}

function applyMode() {
  if (state.demo) loc.startDemo(demoStartPoint());
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

  if (!wakeLockSupported) {
    $('wake-toggle').disabled = true;
    $('wake-help').textContent = 'This browser can’t keep the screen on. Raise auto-lock in your phone’s settings instead.';
  }
}

function openSettings() {
  syncSettingsSheet();
  $('settings-sheet').showModal();
}

initSheets();
initCourseSheet({ showToast });
initDistanceView({ openCourses: openCourseSheet, openSettings });

onState(patch => {
  if ('theme' in patch) applyTheme();
  if ('demo' in patch) applyMode();
  if ('keepAwake' in patch) setWakeLock(state.keepAwake);
  syncSettingsSheet();
});

applyTheme();
applyMode();
setWakeLock(state.keepAwake);
