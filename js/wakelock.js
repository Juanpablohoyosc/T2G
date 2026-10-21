// Keeps the screen on mid-hole where the Screen Wake Lock API exists. The
// browser drops the lock whenever the page is hidden, so it is re-requested
// each time the app comes back to the front.

let wanted = false;
let sentinel = null;

export const wakeLockSupported = 'wakeLock' in navigator;

export function setWakeLock(on) {
  wanted = on;
  if (on) acquire();
  else release();
}

async function acquire() {
  if (!wakeLockSupported || sentinel || document.visibilityState !== 'visible') return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => { sentinel = null; });
  } catch {
    sentinel = null; // low battery mode or a denied request: carry on without it
  }
}

async function release() {
  const s = sentinel;
  sentinel = null;
  try { await s?.release(); } catch { /* already released */ }
}

document.addEventListener('visibilitychange', () => {
  if (wanted && document.visibilityState === 'visible') acquire();
});
