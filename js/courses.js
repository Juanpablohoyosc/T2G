// Saved courses. A course is plain JSON so the same shape works for
// OpenStreetMap imports, the course builder and JSON export/import:
//
// {
//   id, name, source: 'openstreetmap' | 'builder' | 'import', attribution,
//   holes: [{
//     number, par,                     // par may be null when unknown
//     tee: [lat, lon] | null,
//     path: [[lat, lon], ...] | null,  // tee -> green line of play
//     green: { front, center, back },  // [lat, lon] each; front/back may be null
//     greenOutline: [[lat, lon], ...] | null,
//   }],
//   hazards: [{ kind: 'bunker' | 'water', outline: [[lat, lon], ...] }],
// }

import { load, save } from './store.js';
import { haversine, lineThroughRing, pointInRing } from './geo.js';

const KEY = 'courses';

export function listCourses() {
  const list = load(KEY, []);
  return Array.isArray(list) ? list : [];
}

export function getCourse(id) {
  return listCourses().find(c => c.id === id) || null;
}

// Returns false when storage is full or blocked.
export function saveCourse(course) {
  const list = listCourses().filter(c => c.id !== course.id);
  list.push({ ...course, updatedAt: new Date().toISOString() });
  list.sort((a, b) => a.name.localeCompare(b.name));
  return save(KEY, list);
}

export function deleteCourse(id) {
  return save(KEY, listCourses().filter(c => c.id !== id));
}

// The line of play for a hole: the mapped path, or a straight line from the
// tee to the center of the green.
export function holePath(hole) {
  if (hole.path && hole.path.length >= 2) return hole.path;
  if (hole.tee && hole.green?.center) return [hole.tee, hole.green.center];
  return null;
}

// Front, center and back distances (meters) from a position to a hole's green.
// With a mapped green outline, front and back follow your own line to the
// center, so they stay right when you're off to the side of the fairway.
export function greenDistances(hole, point) {
  const c = hole.green?.center;
  if (!point || !c) return null;
  const center = haversine(point, c);
  if (hole.greenOutline) {
    const cut = lineThroughRing(point, c, hole.greenOutline);
    if (cut) return { front: cut.frontDist, center, back: cut.backDist };
  }
  const onGreen = hole.greenOutline && pointInRing(point, hole.greenOutline);
  return {
    front: onGreen ? 0 : hole.green.front ? haversine(point, hole.green.front) : null,
    center,
    back: hole.green.back ? haversine(point, hole.green.back) : null,
  };
}
