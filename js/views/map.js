// Satellite map: tap anywhere to measure (works on any course, mapped or
// not), the current hole drawn over the imagery, and the draggable demo player.

import { state, onState, currentCourse, currentHole, stepHole } from '../state.js';
import { greenDistances, holePath } from '../courses.js';
import * as loc from '../location.js';
import * as demo from '../demo.js';
import { formatDistance, unitLabel, haversine } from '../geo.js';

const $ = id => document.getElementById(id);

const LAYERS = {
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagery © Esri, Maxar, Earthstar Geographics and the GIS User Community',
  },
  street: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
};
const FALLBACK_VIEW = { center: [36.0687, -94.1748], zoom: 13 }; // Fayetteville, AR

let L = null;
let map = null;
let snap = loc.snapshot();
let visible = false;
let needsFit = true;

let layerName = 'satellite';
let baseLayer = null;
let courseLayer = null; // bunkers and water for the whole course
let holeLayer = null;   // current hole: line of play, green, tee, front/back
let drawnCourseId = null;
let courseCredit = null;

let playerMarker = null;
let playerIsDemo = null;
let playerDragging = false;
let accuracyCircle = null;

let target = null;      // [lat, lon] the user tapped
let targetMarker = null;
let targetLines = null;

export function initMapView() {
  $('map-prev').addEventListener('click', () => stepHole(-1));
  $('map-next').addEventListener('click', () => stepHole(1));
  $('layer-btn').addEventListener('click', () => setBase(layerName === 'satellite' ? 'street' : 'satellite'));
  $('fit-btn').addEventListener('click', fitView);
  $('locate-btn').addEventListener('click', () => {
    const p = snap.position?.point;
    if (p && map) map.setView(p, Math.max(map.getZoom(), 17));
  });
  $('clear-target').addEventListener('click', clearTarget);
  $('map-walk').addEventListener('click', () => (demo.isWalking() ? demo.stopWalk() : demo.walk()));

  loc.subscribe(s => {
    snap = s;
    if (!map) return;
    renderPlayer();
    renderTarget();
    renderCard();
  });
  demo.onDemoChange(renderCard);
  onState(patch => {
    if ('courseId' in patch || 'holeIndex' in patch) {
      clearTarget();
      needsFit = true;
    }
    if (!map) return;
    drawCourse();
    if (needsFit && visible) fitView();
    renderTarget();
    renderCard();
  });
}

export function showMap() {
  visible = true;
  if (!map) createMap();
  map.invalidateSize();
  // A demo player with nowhere to stand starts in the middle of the map.
  if (snap.mode === 'demo' && !snap.position) demo.placeAtPoint(latLon(map.getCenter()));
  if (needsFit) fitView();
  renderCard();
}

export function hideMap() {
  visible = false;
}

const latLon = ll => [ll.lat, ll.lng];

function createMap() {
  L = window.L;
  map = L.map('map', { zoomControl: false, zoomSnap: 0.5, tapTolerance: 15 });
  map.attributionControl.setPrefix(false);
  courseLayer = L.layerGroup().addTo(map);
  holeLayer = L.layerGroup().addTo(map);
  targetLines = L.layerGroup().addTo(map);
  setBase('satellite');
  map.setView(FALLBACK_VIEW.center, FALLBACK_VIEW.zoom);
  map.on('click', e => setTarget(latLon(e.latlng)));
  drawCourse();
  renderPlayer();
}

// ---------- base imagery ----------

function setBase(name) {
  if (baseLayer) map.removeLayer(baseLayer);
  layerName = name;
  const { url, attribution } = LAYERS[name];
  baseLayer = L.tileLayer(url, { attribution, maxNativeZoom: 19, maxZoom: 21 }).addTo(map);
  baseLayer.bringToBack();

  // If the satellite imagery can't load at all, fall back to the street map.
  if (name === 'satellite') {
    let loaded = 0, failed = 0;
    baseLayer.on('tileload', () => { loaded++; });
    baseLayer.on('tileerror', () => {
      failed++;
      if (failed >= 6 && loaded === 0 && layerName === 'satellite') setBase('street');
    });
  }
  const toStreet = name === 'satellite';
  $('layer-btn').setAttribute('aria-label', toStreet ? 'Switch to street map' : 'Switch to satellite imagery');
  $('layer-btn').classList.toggle('active', !toStreet);
}

// ---------- course and hole overlays ----------

function drawCourse() {
  const course = currentCourse();
  if ((course?.id || null) !== drawnCourseId) {
    drawnCourseId = course?.id || null;
    courseLayer.clearLayers();
    if (courseCredit) map.attributionControl.removeAttribution(courseCredit);
    courseCredit = course?.attribution || null;
    if (courseCredit) map.attributionControl.addAttribution(courseCredit);
    for (const h of course?.hazards || []) {
      const water = h.kind === 'water';
      L.polygon(h.outline, {
        interactive: false,
        weight: 1,
        color: water ? '#7cc4ff' : '#f6e7b8',
        fillColor: water ? '#3a8ee6' : '#f6e7b8',
        fillOpacity: 0.15,
      }).addTo(courseLayer);
    }
  }

  holeLayer.clearLayers();
  const hole = currentHole();
  const label = $('map-hole-label');
  $('map-hole').hidden = !hole;
  if (!hole) return;
  label.textContent = `Hole ${hole.number}${hole.par ? ` · Par ${hole.par}` : ''}`;

  const path = holePath(hole);
  if (path) {
    L.polyline(path, { interactive: false, color: '#fff', weight: 2, opacity: 0.75, dashArray: '2 7' }).addTo(holeLayer);
  }
  if (hole.greenOutline) {
    L.polygon(hole.greenOutline, {
      interactive: false, color: '#fff', weight: 2, fillColor: '#9dffb5', fillOpacity: 0.12,
    }).addTo(holeLayer);
  }
  if (hole.tee) {
    L.circleMarker(hole.tee, {
      interactive: false, radius: 6, color: '#fff', weight: 2, fillColor: '#9d2235', fillOpacity: 1,
    }).addTo(holeLayer);
  }
  for (const p of [hole.green.front, hole.green.back]) {
    if (p) L.circleMarker(p, { interactive: false, radius: 3, color: '#fff', weight: 2, fillOpacity: 0 }).addTo(holeLayer);
  }
  L.marker(hole.green.center, {
    interactive: false,
    keyboard: false,
    icon: L.divIcon({ className: '', html: '<div class="pin-flag"></div>', iconSize: [22, 30], iconAnchor: [3, 30] }),
  }).addTo(holeLayer);
}

// The whole hole, framed below the hole chip at the top.
function fitView() {
  if (!map) return;
  needsFit = false;
  const hole = currentHole();
  const pad = { paddingTopLeft: [24, 72], paddingBottomRight: [24, 24] };
  if (hole) {
    const pts = [...(holePath(hole) || []), ...(hole.greenOutline || []), hole.green.center];
    map.fitBounds(L.latLngBounds(pts), { ...pad, maxZoom: 19 });
  } else if (snap.position) {
    map.setView(snap.position.point, 17);
  }
}

// ---------- player ----------

function renderPlayer() {
  const point = snap.position?.point;
  const isDemo = snap.mode === 'demo';
  if (!point) {
    if (playerMarker) { map.removeLayer(playerMarker); playerMarker = null; }
    if (accuracyCircle) { map.removeLayer(accuracyCircle); accuracyCircle = null; }
    return;
  }
  if (playerMarker && playerIsDemo !== isDemo) {
    map.removeLayer(playerMarker);
    playerMarker = null;
  }
  if (!playerMarker) {
    playerIsDemo = isDemo;
    playerMarker = L.marker(point, {
      draggable: isDemo,
      keyboard: false,
      zIndexOffset: 1000,
      title: isDemo ? 'Simulated player: drag me' : 'You',
      icon: L.divIcon({
        className: '',
        html: isDemo ? '<div class="player demo"><span>Demo</span></div>' : '<div class="player"></div>',
        iconSize: isDemo ? [48, 48] : [24, 24],
        iconAnchor: isDemo ? [24, 24] : [12, 12],
      }),
    }).addTo(map);
    if (isDemo) {
      playerMarker.on('dragstart', () => { playerDragging = true; demo.stopWalk(); });
      playerMarker.on('drag', e => demo.placeAtPoint(latLon(e.target.getLatLng())));
      playerMarker.on('dragend', () => { playerDragging = false; });
    }
  } else if (!playerDragging) {
    playerMarker.setLatLng(point);
  }

  const acc = !isDemo && snap.position.accuracy;
  if (acc) {
    if (!accuracyCircle) {
      accuracyCircle = L.circle(point, {
        interactive: false, radius: acc, color: '#4da3ff', weight: 1, fillColor: '#4da3ff', fillOpacity: 0.12,
      }).addTo(map);
    } else {
      accuracyCircle.setLatLng(point).setRadius(acc);
    }
  } else if (accuracyCircle) {
    map.removeLayer(accuracyCircle);
    accuracyCircle = null;
  }
}

// ---------- tap-to-measure ----------

function setTarget(point) {
  target = point;
  if (!targetMarker) {
    targetMarker = L.marker(point, {
      draggable: true,
      keyboard: false,
      zIndexOffset: 900,
      icon: L.divIcon({ className: '', html: '<div class="target"></div>', iconSize: [36, 36], iconAnchor: [18, 18] }),
    }).addTo(map);
    targetMarker.bindTooltip('', { permanent: true, direction: 'top', offset: [0, -16], className: 'dist-tip' });
    targetMarker.on('drag', e => {
      target = latLon(e.target.getLatLng());
      renderTarget();
      renderCard();
    });
  } else {
    targetMarker.setLatLng(point);
  }
  renderTarget();
  renderCard();
}

function clearTarget() {
  target = null;
  if (targetMarker) { map.removeLayer(targetMarker); targetMarker = null; }
  targetLines?.clearLayers();
  if (map) renderCard();
}

function renderTarget() {
  if (!target || !map) return;
  targetLines.clearLayers();
  const player = snap.position?.point;
  const center = currentHole()?.green.center;
  if (player) {
    L.polyline([player, target], { interactive: false, color: '#fff', weight: 3, opacity: 0.95 }).addTo(targetLines);
  }
  if (center) {
    L.polyline([target, center], { interactive: false, color: '#fff', weight: 2, opacity: 0.9, dashArray: '6 6' }).addTo(targetLines);
  }
  const text = player ? `${formatDistance(haversine(player, target), state.units)} ${unitLabel(state.units)}` : '—';
  targetMarker.setTooltipContent(text);
}

// ---------- the card under the map ----------

function renderCard() {
  const hole = currentHole();
  const point = snap.position?.point;
  const u = state.units;
  const fmt = m => (m == null ? '—' : formatDistance(m, u));

  const green = $('measure-green');
  const d = hole ? greenDistances(hole, point) : null;
  green.hidden = !hole || !!target;
  $('mg-front').textContent = fmt(d?.front);
  $('mg-center').textContent = d ? `${fmt(d.center)} ${unitLabel(u)}` : '—';
  $('mg-back').textContent = fmt(d?.back);

  $('measure-target').hidden = !target;
  if (target) {
    $('mt-you').textContent = point ? `${fmt(haversine(point, target))} ${unitLabel(u)}` : '—';
    $('mt-green-box').hidden = !hole;
    if (hole) $('mt-green').textContent = `${fmt(haversine(target, hole.green.center))} ${unitLabel(u)}`;
  }

  const hint = $('measure-hint');
  if (target && !point) hint.textContent = 'Waiting for your position…';
  else if (target) hint.textContent = 'Drag the target to fine-tune it.';
  else hint.textContent = hole ? 'Tap the map to measure to any spot.' : 'Tap the map to measure to any spot, on any course.';

  const walk = $('map-demo');
  walk.hidden = !(snap.mode === 'demo' && hole);
  $('map-walk').textContent = demo.isWalking() ? 'Stop walking' : 'Auto-walk to green';
}
