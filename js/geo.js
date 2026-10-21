// Distance math. Every point in the app is a [lat, lon] array (the same shape Leaflet uses).

const R = 6371008.8; // mean Earth radius in meters
const RAD = Math.PI / 180;
export const M_PER_YD = 0.9144;

// Great-circle distance in meters (Haversine formula).
export function haversine(a, b) {
  const dLat = (b[0] - a[0]) * RAD;
  const dLon = (b[1] - a[1]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function toUnits(meters, units) {
  return units === 'm' ? meters : meters / M_PER_YD;
}

export function formatDistance(meters, units) {
  if (meters == null || !Number.isFinite(meters)) return '—';
  return Math.round(toUnits(meters, units)).toLocaleString('en-US');
}

export const unitLabel = units => (units === 'm' ? 'm' : 'yd');

// Flat x/y meters around an origin. Over the size of a golf hole the error is
// far below a yard, and it makes polygon math simple.
export function project(origin, p) {
  return [
    (p[1] - origin[1]) * RAD * Math.cos(origin[0] * RAD) * R,
    (p[0] - origin[0]) * RAD * R,
  ];
}

export function unproject(origin, [x, y]) {
  return [
    origin[0] + y / R / RAD,
    origin[1] + x / (R * Math.cos(origin[0] * RAD)) / RAD,
  ];
}

// Area-weighted centroid of a polygon ring.
export function centroid(ring) {
  if (!ring || ring.length < 3) return null;
  const o = ring[0];
  const pts = ring.map(p => project(o, p));
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    const f = x1 * y2 - x2 * y1;
    a += f;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  if (Math.abs(a) < 1e-9) return ring[0];
  return unproject(o, [cx / (3 * a), cy / (3 * a)]);
}

// Even-odd point-in-polygon test.
export function pointInRing(p, ring) {
  if (!ring || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    if ((yi > p[0]) !== (yj > p[0]) &&
        p[1] < ((xj - xi) * (p[0] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pathLength(path) {
  let d = 0;
  for (let i = 1; i < path.length; i++) d += haversine(path[i - 1], path[i]);
  return d;
}

// The point a given fraction (0..1) of the way along a path.
export function pointAlong(path, fraction) {
  if (!path || path.length === 0) return null;
  if (path.length === 1) return path[0];
  const target = pathLength(path) * Math.min(1, Math.max(0, fraction));
  let walked = 0;
  for (let i = 1; i < path.length; i++) {
    const seg = haversine(path[i - 1], path[i]);
    if (walked + seg >= target) {
      const t = seg === 0 ? 0 : (target - walked) / seg;
      return [
        path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t,
        path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t,
      ];
    }
    walked += seg;
  }
  return path[path.length - 1];
}

// Where the line from `from` through `through` crosses the polygon edge.
// Returns the near (front) and far (back) crossings with their distances from
// `from` in meters, or null if the line misses the polygon.
export function lineThroughRing(from, through, ring) {
  if (!ring || ring.length < 3) return null;
  const p = project(through, from);
  const len = Math.hypot(p[0], p[1]);
  if (len < 0.5) return null;
  const d = [-p[0] / len, -p[1] / len];
  const pts = ring.map(q => project(through, q));
  const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
  const hits = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const e = [b[0] - a[0], b[1] - a[1]];
    const denom = cross(d, e);
    if (Math.abs(denom) < 1e-12) continue;
    const ap = [a[0] - p[0], a[1] - p[1]];
    const t = cross(ap, e) / denom;
    const s = cross(ap, d) / denom;
    if (s >= 0 && s <= 1) hits.push(t);
  }
  const ahead = hits.filter(t => t >= 0);
  if (ahead.length === 0) return null;
  const tFar = Math.max(...ahead);
  // Standing on the green: the front edge is behind you, so it reads 0.
  const tNear = pointInRing(from, ring) ? 0 : Math.min(...ahead);
  const at = t => unproject(through, [p[0] + d[0] * t, p[1] + d[1] * t]);
  return { front: at(tNear), back: at(tFar), frontDist: tNear, backDist: tFar };
}
