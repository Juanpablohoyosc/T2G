// Main screen: front / center / back of the current green, hole switching,
// GPS accuracy and the demo-mode position slider.

import { state, onState, currentCourse, currentHole, stepHole } from '../state.js';
import { greenDistances } from '../courses.js';
import * as loc from '../location.js';
import * as demo from '../demo.js';
import { formatDistance, unitLabel, toUnits, haversine, pointAlong, M_PER_YD } from '../geo.js';

const $ = id => document.getElementById(id);

const WEAK_ACCURACY = 10 * M_PER_YD; // warn when GPS is worse than ±10 yd
const FAR_AWAY = 1500 * M_PER_YD;    // farther than this, you're not on the hole
const STALE_MS = 60000;              // no fix for a minute: the signal likely dropped

let snap = loc.snapshot();

export function initDistanceView({ openCourses, openSettings }) {
  $('empty-course-btn').addEventListener('click', openCourses);
  $('prev-hole').addEventListener('click', () => stepHole(-1));
  $('next-hole').addEventListener('click', () => stepHole(1));

  $('gps-status').addEventListener('click', () => {
    if (snap.mode === 'demo') openSettings();
    else if (snap.status !== 'ok' || isStale()) loc.startGps();
  });

  $('demo-slider').addEventListener('input', e => demo.placeAtFraction(Number(e.target.value) / 1000));
  $('demo-chips').addEventListener('click', e => {
    const to = e.target.closest('button')?.dataset.to;
    if (!to) return;
    demo.placeAtFraction(to === 'tee' ? 0 : fractionAtDistanceToCenter(Number(to)));
  });
  $('demo-walk').addEventListener('click', () => (demo.isWalking() ? demo.stopWalk() : demo.walk()));
  demo.onDemoChange(() => { const hole = currentHole(); if (hole) renderDemoPanel(hole); });

  bindSwipe($('gps-view'));

  loc.subscribe(s => { snap = s; render(); });
  onState(render);
  setInterval(renderStatus, 5000);
  render();
}

// Swipe left/right anywhere on the main screen to change holes.
function bindSwipe(el) {
  let start = null;
  el.addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || e.target.closest('.demo-panel')) { start = null; return; }
    start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });
  el.addEventListener('touchend', e => {
    if (!start) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    start = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) stepHole(dx < 0 ? 1 : -1);
  }, { passive: true });
}

// ---------- demo player ----------

function fractionAtDistanceToCenter(target) {
  const hole = currentHole();
  if (!hole) return 0;
  const path = demo.demoPath(hole);
  const meters = target * (state.units === 'm' ? 1 : M_PER_YD);
  let lo = 0, hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (haversine(pointAlong(path, mid), hole.green.center) > meters) lo = mid;
    else hi = mid;
  }
  return lo;
}

// ---------- rendering ----------

function isStale() {
  return snap.mode === 'gps' && snap.position && Date.now() - snap.position.timestamp > STALE_MS;
}

function render() {
  const course = currentCourse();
  const hole = currentHole();
  $('empty-state').hidden = !!hole;
  $('hole-view').hidden = !hole;
  $('course-name').textContent = course ? course.name : 'Choose a course';
  $('data-source').textContent = course?.attribution || '';
  renderStatus();
  if (!hole) return;

  $('hole-num').textContent = hole.number;
  $('hole-par').textContent = hole.par ? `Par ${hole.par}` : 'Par —';
  $('hole-of').textContent = `of ${course.holes.length}`;
  $('d-unit').textContent = unitLabel(state.units);

  renderDistances(hole);
  renderDemoPanel(hole);
}

function renderDistances(hole) {
  const point = snap.position?.point;
  const d = greenDistances(hole, point);
  const note = $('dist-note');
  const far = d && d.center > FAR_AWAY;
  const show = m => (d && !far ? formatDistance(m, state.units) : '—');

  $('d-front').textContent = show(d?.front);
  $('d-center').textContent = show(d?.center);
  $('d-back').textContent = show(d?.back);
  $('dists').classList.toggle('stale', !!isStale());

  let text = '';
  if (far) {
    const miles = d.center / 1609.344;
    text = `You're ${miles.toFixed(1)} mi from hole ${hole.number}. Turn on Demo mode in Settings to try it from here.`;
  } else if (d && (d.front == null || d.back == null)) {
    text = 'This green has no outline mapped, so only the center is shown.';
  } else if (snap.mode === 'gps' && snap.status === 'denied') {
    text = 'Location is blocked for this site. On iPhone: Settings › Privacy & Security › Location Services › Safari Websites › While Using. Or turn on Demo mode.';
  } else if (snap.mode === 'gps' && snap.position?.accuracy > WEAK_ACCURACY) {
    text = `GPS is weak right now, so these numbers can be off by ±${formatDistance(snap.position.accuracy, state.units)} ${unitLabel(state.units)}.`;
  } else if (!point && snap.mode === 'gps') {
    text = 'Waiting for your position…';
  }
  note.textContent = text;
  note.hidden = !text;
}

function renderDemoPanel(hole) {
  const panel = $('demo-panel');
  panel.hidden = snap.mode !== 'demo';
  if (panel.hidden) return;
  const path = demo.demoPath(hole);
  const point = snap.position?.point;
  const fraction = demo.getFraction();
  if (fraction != null) $('demo-slider').value = Math.round(fraction * 1000);
  $('demo-out').textContent = point
    ? `${formatDistance(haversine(path[0], point), state.units)} ${unitLabel(state.units)} from tee`
    : '';

  const walking = demo.isWalking();
  const walkBtn = $('demo-walk');
  walkBtn.setAttribute('aria-label', walking ? 'Stop walking' : 'Auto-walk to the green');
  walkBtn.classList.toggle('walking', walking);

  const toCenter = toUnits(haversine(path[0], hole.green.center), state.units);
  $('demo-chips').querySelectorAll('button[data-to]').forEach(b => {
    if (b.dataset.to !== 'tee') b.disabled = Number(b.dataset.to) >= toCenter;
  });
}

function renderStatus() {
  const btn = $('gps-status');
  const text = $('gps-text');
  const units = state.units;
  let cls = '', msg = '';

  if (snap.mode === 'demo') {
    cls = 'demo';
    msg = 'DEMO · simulated';
  } else if (snap.status === 'denied') {
    cls = 'bad';
    msg = 'Location blocked · tap to retry';
  } else if (snap.status === 'insecure') {
    cls = 'bad';
    msg = 'GPS needs an https:// address';
  } else if (snap.status === 'unsupported') {
    cls = 'bad';
    msg = 'This browser has no GPS access';
  } else if (snap.status === 'unavailable') {
    cls = 'bad';
    msg = 'GPS unavailable. Tap to retry';
  } else if (snap.status === 'ok' && snap.position) {
    const acc = `±${formatDistance(snap.position.accuracy, units)} ${unitLabel(units)}`;
    if (isStale()) {
      cls = 'warn';
      msg = `No GPS update for ${Math.round((Date.now() - snap.position.timestamp) / 1000)} s`;
    } else if (snap.position.accuracy > WEAK_ACCURACY) {
      cls = 'warn';
      msg = `Weak GPS ${acc}`;
    } else {
      cls = 'good';
      msg = `GPS ${acc}`;
    }
  } else {
    cls = 'wait';
    msg = 'Finding GPS…';
  }

  btn.className = `gps-status ${cls}`;
  text.textContent = msg;
  if (state.courseId) renderDistancesIfStale();
}

let wasStale = false;
function renderDistancesIfStale() {
  const stale = !!isStale();
  if (stale === wasStale) return;
  wasStale = stale;
  const hole = currentHole();
  if (hole) renderDistances(hole);
}
