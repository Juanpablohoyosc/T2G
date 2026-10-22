// App settings and "where am I in the round" state, saved between visits.

import { load, save } from './store.js';
import { getCourse } from './courses.js';

const saved = load('settings', {}) || {};

export const state = {
  units: saved.units === 'm' ? 'm' : 'yd',
  theme: saved.theme === 'sun' ? 'sun' : 'dark',
  demo: saved.demo === true,
  keepAwake: saved.keepAwake !== false,
  courseId: typeof saved.courseId === 'string' ? saved.courseId : null,
  holeIndex: Number.isInteger(saved.holeIndex) ? saved.holeIndex : 0,
};

const listeners = new Set();

export function onState(fn) {
  listeners.add(fn);
}

export function setState(patch) {
  Object.assign(state, patch);
  save('settings', state);
  listeners.forEach(fn => fn(patch));
}

let cached = null;

export function currentCourse() {
  if (!state.courseId) return null;
  if (!cached || cached.id !== state.courseId) cached = getCourse(state.courseId);
  return cached;
}

export function forgetCachedCourse() {
  cached = null;
}

export function currentHole() {
  const course = currentCourse();
  if (!course || !course.holes.length) return null;
  return course.holes[Math.min(Math.max(state.holeIndex, 0), course.holes.length - 1)];
}

export function stepHole(dir) {
  const course = currentCourse();
  if (!course || !course.holes.length) return;
  const n = course.holes.length;
  setState({ holeIndex: (state.holeIndex + dir + n) % n });
}
