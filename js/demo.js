// The simulated golfer in demo mode: where they stand and the auto-walk.
// The yardage screen's slider and the map's draggable player both move the
// player through here, and everything else just sees the position stream.

import * as loc from './location.js';
import { currentHole } from './state.js';
import { holePath } from './courses.js';
import { pointAlong, pathLength, unproject } from './geo.js';

const WALK_SPEED = 25;            // meters per second of animation (sped up)
const WALK_MIN_MS = 8000;
const WALK_MAX_MS = 20000;

let fraction = 0;                 // share of the hole walked; null once dragged off the line
let frame = null;
const listeners = new Set();

export function onDemoChange(fn) {
  listeners.add(fn);
}

function changed() {
  listeners.forEach(fn => fn());
}

// The line the player walks. A hole with no tee mapped gets a stand-in start
// 150 m short of the green so the demo still works.
export function demoPath(hole) {
  return holePath(hole) || [unproject(hole.green.center, [0, -150]), hole.green.center];
}

export function getFraction() {
  return fraction;
}

export function isWalking() {
  return frame != null;
}

// Where demo mode starts the player: on the current hole's line, if any.
export function startPoint() {
  const hole = currentHole();
  return hole ? pointAlong(demoPath(hole), fraction ?? 0) : null;
}

export function placeAtFraction(f) {
  stopWalk();
  fraction = Math.min(1, Math.max(0, f));
  const point = startPoint();
  if (point) loc.setDemoPosition(point);
  changed();
}

export function placeAtPoint(point) {
  stopWalk();
  fraction = null;
  loc.setDemoPosition(point);
  changed();
}

export function resetToTee() {
  placeAtFraction(0);
}

// Walk from where the player is on the hole to the green, then stop.
export function walk() {
  const hole = currentHole();
  if (!hole || loc.snapshot().mode !== 'demo') return;
  stopWalk();
  const path = demoPath(hole);
  const from = fraction == null || fraction >= 0.999 ? 0 : fraction;
  const ms = Math.min(WALK_MAX_MS, Math.max(WALK_MIN_MS, (pathLength(path) * (1 - from) / WALK_SPEED) * 1000));
  const t0 = performance.now();

  const step = now => {
    const t = Math.min(1, (now - t0) / ms);
    fraction = from + (1 - from) * t;
    loc.setDemoPosition(pointAlong(path, fraction));
    if (t < 1) {
      frame = requestAnimationFrame(step);
    } else {
      frame = null;
    }
    changed();
  };
  frame = requestAnimationFrame(step);
  changed();
}

export function stopWalk() {
  if (frame == null) return;
  cancelAnimationFrame(frame);
  frame = null;
  changed();
}
