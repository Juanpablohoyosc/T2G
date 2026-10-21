// One position stream for the whole app. Screens subscribe here and never talk
// to the GPS directly, so demo mode and real GPS behave exactly the same.

const listeners = new Set();

const state = {
  mode: 'off',     // 'gps' | 'demo' | 'off'
  status: 'idle',  // 'idle' | 'waiting' | 'ok' | 'denied' | 'unavailable' | 'unsupported' | 'insecure'
  position: null,  // { point: [lat, lon], accuracy: meters, timestamp: ms, simulated: bool }
};

let watchId = null;

export function subscribe(fn) {
  listeners.add(fn);
  fn(snapshot());
  return () => listeners.delete(fn);
}

export function snapshot() {
  return { ...state };
}

function emit() {
  const snap = snapshot();
  listeners.forEach(fn => fn(snap));
}

export function startGps() {
  stopGps();
  state.mode = 'gps';
  state.position = null;
  if (!window.isSecureContext) {
    state.status = 'insecure';
  } else if (!('geolocation' in navigator)) {
    state.status = 'unsupported';
  } else {
    state.status = 'waiting';
    watchId = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 20000,
    });
  }
  emit();
}

export function stopGps() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
}

function onPosition(pos) {
  if (state.mode !== 'gps') return;
  state.status = 'ok';
  state.position = {
    point: [pos.coords.latitude, pos.coords.longitude],
    accuracy: pos.coords.accuracy,
    timestamp: pos.timestamp || Date.now(),
    simulated: false,
  };
  emit();
}

function onError(err) {
  if (state.mode !== 'gps') return;
  if (err.code === 1) state.status = 'denied';
  else if (err.code === 2) state.status = 'unavailable';
  // code 3 is a timeout: keep the watch running and keep the last fix.
  else if (!state.position) state.status = 'waiting';
  emit();
}

// Demo mode: GPS is switched off and the position only moves when the app
// (or the presenter) moves it.
export function startDemo(point = null) {
  stopGps();
  state.mode = 'demo';
  state.status = 'ok';
  state.position = point ? simulated(point) : null;
  emit();
}

export function setDemoPosition(point) {
  if (state.mode !== 'demo') return;
  state.position = simulated(point);
  emit();
}

function simulated(point) {
  return { point, accuracy: 0, timestamp: Date.now(), simulated: true };
}
