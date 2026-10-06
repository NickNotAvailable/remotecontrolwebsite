/**
 * Picture "effects state" shared by both renderers, plus the short timelines that animate it
 * (channel change, power on/off). Renderers read `fx.params` every frame.
 */

export interface FxParams {
  /** TV snow, 0…1. */
  noise: number;
  /** Horizontal tearing / line displacement, 0…1. */
  glitch: number;
  /** Chromatic separation in CSS px. */
  rgb: number;
  /** Vertical roll offset (0…1 wraps one full frame). */
  roll: number;
  /** Overall brightness multiplier (0 = black frame). */
  bright: number;
  /** CRT power animation: vertical / horizontal scale of the picture, 0…1. */
  powerY: number;
  powerX: number;
  /** White-out of the picture while it collapses / expands. */
  glow: number;
  /** Afterglow dot left in the middle of the tube after switching off. */
  dot: number;
  /** VHS tracking band intensity (used while paused / buffering). */
  tracking: number;
}

/** Always-on "look" — kept deliberately light so the work stays watchable. */
export interface FxLook {
  scanlines: number;
  grain: number;
  vignette: number;
  curvature: number;
  aberration: number;
}

export const DEFAULT_LOOK: FxLook = {
  scanlines: 0.075,
  grain: 0.035,
  vignette: 0.22,
  curvature: 0.035,
  aberration: 0.6,
};

export const restingParams = (): FxParams => ({
  noise: 0,
  glitch: 0,
  rgb: 0,
  roll: 0,
  bright: 1,
  powerY: 1,
  powerX: 1,
  glow: 0,
  dot: 0,
  tracking: 0,
});

type Keyframes = [t: number, v: number][];
type Track = Partial<Record<keyof FxParams, Keyframes>>;

interface Timeline {
  duration: number;
  tracks: Track;
  /** Named moments (ms) — e.g. `cut` is when the picture source switches. */
  marks?: Record<string, number>;
}

interface Running {
  timeline: Timeline;
  start: number;
  offset: number;
  fired: Set<string>;
  onMark?: (name: string) => void;
  resolve: () => void;
}

const easeOut = (x: number) => 1 - (1 - x) * (1 - x);

function sample(frames: Keyframes, t: number): number {
  if (t <= frames[0][0]) return frames[0][1];
  for (let i = 1; i < frames.length; i++) {
    const [t1, v1] = frames[i];
    if (t <= t1) {
      const [t0, v0] = frames[i - 1];
      const x = (t - t0) / Math.max(1, t1 - t0);
      return v0 + (v1 - v0) * easeOut(x);
    }
  }
  return frames[frames.length - 1][1];
}

/** Small random wobble so no two channel changes look identical. */
const jitter = (base: number, amount = 0.25) => base * (1 - amount + Math.random() * amount * 2);

/**
 * Channel change (~560 ms): detune → black frame → snow + vertical roll → picture locks back in
 * with fading RGB split. The picture source switches at the `cut` mark, hidden under the snow.
 * Re-tuning mid-transition restarts from `SURF_FROM` so channel-surfing stays in the snow.
 */
export const SURF_FROM = 150;

export function channelChangeTimeline(): Timeline {
  const cut = 230;
  const settleEnd = 560;
  const rollDir = Math.random() < 0.5 ? -1 : 1;
  return {
    duration: settleEnd,
    marks: { cut, reveal: 330 },
    tracks: {
      glitch: [[0, 0], [70, 1], [330, 0.9], [settleEnd, 0]],
      rgb: [[0, 0], [60, jitter(10)], [140, 4], [330, jitter(9)], [settleEnd, 0]],
      noise: [[0, 0], [60, 0.25], [95, 0.35], [140, 0.95], [300, 0.92], [settleEnd, 0]],
      bright: [[0, 1], [40, 1.25], [90, 0.85], [100, 0.04], [140, 0.04], [150, 1], [settleEnd, 1]],
      roll: [[0, 0], [140, 0], [330, rollDir * jitter(0.6, 0.2)], [settleEnd, rollDir * 1]],
    },
  };
}

/** Classic CRT switch-off: raster collapses to a bright line, then a dot that slowly fades. */
export function powerOffTimeline(): Timeline {
  return {
    duration: 1500,
    tracks: {
      glow: [[0, 0], [90, 0.55], [260, 1], [1500, 1]],
      powerY: [[0, 1], [220, 0.004], [1500, 0.004]],
      powerX: [[0, 1], [220, 1], [420, 0.003], [1500, 0.003]],
      bright: [[0, 1], [220, 1.4], [520, 0], [1500, 0]],
      dot: [[0, 0], [380, 1], [600, 0.8], [1500, 0]],
      noise: [[0, 0], [120, 0.15], [220, 0]],
    },
  };
}

/** Parameters held while the TV is switched off. */
export const POWER_OFF_HOLD: Partial<FxParams> = { powerY: 0.004, powerX: 0.003, bright: 0, glow: 1, dot: 0 };

export function powerOnTimeline(): Timeline {
  return {
    duration: 900,
    marks: { picture: 300 },
    tracks: {
      dot: [[0, 0.8], [160, 1], [260, 0]],
      powerX: [[0, 0.003], [140, 0.003], [300, 1]],
      powerY: [[0, 0.004], [300, 0.004], [480, 1]],
      glow: [[0, 1], [300, 1], [520, 0.25], [900, 0]],
      bright: [[0, 0], [140, 1.3], [520, 1.15], [900, 1]],
      noise: [[0, 0], [300, 0.5], [520, 0.25], [900, 0]],
      rgb: [[0, 0], [400, 6], [900, 0]],
      glitch: [[0, 0], [420, 0.4], [900, 0]],
    },
  };
}

export class Fx {
  params: FxParams = restingParams();
  look: FxLook = { ...DEFAULT_LOOK };
  /** Extra snow on top of timelines: weak signal while buffering, NO SIGNAL… */
  ambientNoise = 0;
  ambientTracking = 0;
  private running: Running | null = null;
  /** Held state after a timeline ends (e.g. TV off stays collapsed). */
  private hold: Partial<FxParams> = {};

  get busy(): boolean {
    return this.running !== null;
  }

  /** Elapsed ms in the running timeline, or -1. */
  elapsed(now = performance.now()): number {
    return this.running ? now - this.running.start + this.running.offset : -1;
  }

  run(timeline: Timeline, opts: { from?: number; onMark?: (name: string) => void; hold?: Partial<FxParams> } = {}) {
    // Interrupting a timeline resolves its promise so callers never hang.
    this.running?.resolve();
    this.hold = opts.hold ?? {};
    return new Promise<void>((resolve) => {
      const offset = opts.from ?? 0;
      const fired = new Set<string>();
      for (const [name, at] of Object.entries(timeline.marks ?? {})) if (at < offset) fired.add(name);
      this.running = { timeline, start: performance.now(), offset, fired, onMark: opts.onMark, resolve };
    });
  }

  /** Called by the renderer once per frame. */
  update(now: number): FxParams {
    const p = restingParams();
    Object.assign(p, this.hold);
    const r = this.running;
    if (r) {
      const t = now - r.start + r.offset;
      for (const [key, frames] of Object.entries(r.timeline.tracks) as [keyof FxParams, Keyframes][]) {
        p[key] = sample(frames, t);
      }
      for (const [name, at] of Object.entries(r.timeline.marks ?? {})) {
        if (t >= at && !r.fired.has(name)) {
          r.fired.add(name);
          r.onMark?.(name);
        }
      }
      if (t >= r.timeline.duration) {
        this.running = null;
        r.resolve();
      }
    }
    p.noise = Math.min(1, Math.max(p.noise, this.ambientNoise));
    p.tracking = Math.max(p.tracking, this.ambientTracking);
    // `roll` of ±1 is a full frame: identical to 0, so wrap it.
    p.roll = p.roll - Math.trunc(p.roll);
    this.params = p;
    return p;
  }
}
