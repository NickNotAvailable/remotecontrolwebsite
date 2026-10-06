/** Keep the phone's screen awake while it's being used as a remote (Screen Wake Lock API). */
type Sentinel = { released: boolean; release(): Promise<void>; addEventListener(t: 'release', cb: () => void): void };

let sentinel: Sentinel | null = null;
let wanted = false;

async function acquire(): Promise<void> {
  const wl = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } }).wakeLock;
  if (!wl || document.visibilityState !== 'visible' || (sentinel && !sentinel.released)) return;
  try {
    sentinel = await wl.request('screen');
    sentinel.addEventListener('release', () => (sentinel = null));
  } catch {
    /* denied (battery saver, iframe…) — fine */
  }
}

export function keepAwake(): void {
  if (!wanted) {
    wanted = true;
    document.addEventListener('visibilitychange', () => {
      if (wanted && document.visibilityState === 'visible') void acquire();
    });
  }
  void acquire();
}

export function releaseAwake(): void {
  wanted = false;
  void sentinel?.release();
  sentinel = null;
}
