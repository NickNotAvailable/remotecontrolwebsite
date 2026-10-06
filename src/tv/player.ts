import type { Channel } from '../data/channels';
import { Emitter } from '../shared/emitter';
import { VOLUME_STEPS } from '../shared/protocol';

type PlayerEvents = {
  /** The browser refused to play sound; someone has to click/tap the TV page. */
  soundBlocked: boolean;
  buffering: { index: number; buffering: boolean };
  error: { index: number };
};

/**
 * One <video> element per channel, created up front so every channel can buffer ahead of time.
 * Only the tuned channel (plus, briefly, the outgoing one during a transition) ever plays.
 *
 * Audio policy handling:
 *  - Everything starts muted, so autoplay always works.
 *  - The *desired* mute state is tracked separately from what the element is actually allowed to do.
 *    If the user (or a remote) asks for sound before the TV page has had a user gesture, we keep
 *    the element muted, flag `soundBlocked`, and apply the sound on the next click/keypress.
 */
export class ChannelPlayer extends Emitter<PlayerEvents> {
  readonly videos: HTMLVideoElement[];
  private current = -1;
  private wantMuted = true;
  private wantPlaying = true;
  private level = 12;
  private blocked = false;
  private gestureSeen = false;
  private failed = new Set<number>();
  /** TV switched off: every pause is ours, not the browser's. */
  private asleep = false;
  readonly volumeControllable: boolean;

  constructor(
    channels: Channel[],
    host: HTMLElement,
    private readonly preloadAll: boolean,
    /** Ignore `navigator.userActivation` (automation reports it as always active). */
    private readonly strictAutoplay = false,
  ) {
    super();
    this.videos = channels.map((channel, index) => this.createVideo(channel, index));
    for (const v of this.videos) host.append(v);
    this.volumeControllable = detectVolumeControl();
    const onGesture = () => this.onUserGesture();
    // capture phase so we run before any handler that might stopPropagation()
    window.addEventListener('pointerdown', onGesture, true);
    window.addEventListener('keydown', onGesture, true);
    window.addEventListener('touchend', onGesture, true);
  }

  get index(): number {
    return this.current;
  }

  get active(): HTMLVideoElement | null {
    return this.videos[this.current] ?? null;
  }

  get soundBlocked(): boolean {
    return this.blocked;
  }

  get hasFailed(): boolean {
    return this.failed.has(this.current);
  }

  hasUserActivation(): boolean {
    const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    if (this.strictAutoplay || !ua) return this.gestureSeen;
    return ua.hasBeenActive || this.gestureSeen;
  }

  /** Makes `index` the active channel and starts it. The previous one keeps playing until `release()`. */
  tune(index: number): void {
    this.current = index;
    const v = this.videos[index];
    v.volume = this.volumeValue();
    v.muted = this.effectiveMuted();
    if (this.wantPlaying) this.safePlay(v);
    this.updatePreload();
  }

  /** Pause a channel that is no longer on screen. */
  release(index: number): void {
    if (index === this.current || index < 0) return;
    const v = this.videos[index];
    v.muted = true;
    v.pause();
  }

  setPlaying(playing: boolean): void {
    this.wantPlaying = playing;
    const v = this.active;
    if (!v) return;
    if (playing) this.safePlay(v);
    else v.pause();
  }

  setMuted(muted: boolean): void {
    this.wantMuted = muted;
    this.applyAudio();
  }

  /** 0…VOLUME_STEPS */
  setVolume(level: number): void {
    this.level = level;
    const v = this.active;
    if (v) v.volume = this.volumeValue();
  }

  /** Stop everything (TV standby). */
  standby(): void {
    this.asleep = true;
    for (const v of this.videos) v.pause();
  }

  /** Leave standby; the next `tune()` starts the picture. */
  wake(): void {
    this.asleep = false;
  }

  /* ------------------------------------------------------------------------------------- */

  private createVideo(channel: Channel, index: number): HTMLVideoElement {
    const v = document.createElement('video');
    v.className = 'channel-video';
    v.dataset.channel = String(channel.number);
    v.muted = true;
    v.defaultMuted = true;
    v.setAttribute('muted', '');
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    v.loop = true;
    v.preload = 'metadata';
    v.disablePictureInPicture = true;
    v.setAttribute('disableremoteplayback', '');
    v.setAttribute('aria-hidden', 'true');
    v.tabIndex = -1;
    v.poster = channel.poster;

    const source = pickSource(channel);
    // Cross-origin media must be CORS-enabled for WebGL to read it; same-origin needs nothing.
    if (source && new URL(source, location.href).origin !== location.origin) v.crossOrigin = 'anonymous';
    if (source) v.src = source;
    else this.failed.add(index);

    v.addEventListener('waiting', () => index === this.current && this.emit('buffering', { index, buffering: true }));
    v.addEventListener('playing', () => {
      if (index !== this.current) return;
      this.emit('buffering', { index, buffering: false });
      // Some browsers resolve play() for unmuted media but pause it moments later; nothing to do here.
    });
    v.addEventListener('pause', () => this.onPause(v, index));
    v.addEventListener('canplaythrough', () => {
      if (index === this.current && this.preloadAll) this.preloadEverything();
    });
    v.addEventListener('error', () => {
      if (v.crossOrigin && v.src) {
        // The host might not send CORS headers. Retry plainly; the renderer falls back to DOM mode.
        console.warn(`[player] ${channel.id}: CORS load failed, retrying without crossOrigin`);
        const src = v.src;
        v.removeAttribute('crossorigin');
        v.src = src;
        v.load();
        return;
      }
      this.failed.add(index);
      this.emit('error', { index });
    });
    return v;
  }

  private onPause(v: HTMLVideoElement, index: number): void {
    // Chrome pauses an autoplaying video if it gets unmuted without a user gesture.
    if (this.asleep || index !== this.current || !this.wantPlaying || v.muted || document.hidden) return;
    queueMicrotask(() => {
      if (this.asleep || index !== this.current || !this.wantPlaying || !v.paused) return;
      console.info('[player] browser paused unmuted playback; waiting for a gesture');
      v.muted = true;
      this.setBlocked(true);
      void v.play().catch(() => {});
    });
  }

  private onUserGesture(): void {
    const first = !this.gestureSeen;
    this.gestureSeen = true;
    if (first && this.preloadAll) {
      // "Bless" every element inside the gesture so later programmatic play() calls (from the remote,
      // channel changes) are allowed by stricter browsers. Muted, so nothing is heard.
      this.videos.forEach((v, i) => {
        if (i === this.current) return;
        const wasPaused = v.paused;
        void v
          .play()
          .then(() => {
            if (i !== this.current && wasPaused) v.pause();
          })
          .catch(() => {});
      });
    }
    if (this.blocked) this.applyAudio();
  }

  private applyAudio(): void {
    const v = this.active;
    if (!v) return;
    v.volume = this.volumeValue();
    if (this.wantMuted) {
      v.muted = true;
      this.setBlocked(false);
      return;
    }
    if (!this.hasUserActivation()) {
      v.muted = true;
      this.setBlocked(true);
      return;
    }
    v.muted = false;
    if (this.wantPlaying) this.safePlay(v);
    else this.setBlocked(false);
  }

  private safePlay(v: HTMLVideoElement): void {
    const wantSound = !v.muted;
    v.play().then(
      () => {
        if (wantSound && v === this.active) this.setBlocked(false);
      },
      (err: DOMException) => {
        if (err?.name === 'NotAllowedError' && !v.muted) {
          v.muted = true;
          this.setBlocked(true);
          void v.play().catch(() => {});
        }
        // AbortError: superseded by pause()/load(); nothing to do.
      },
    );
  }

  private effectiveMuted(): boolean {
    if (this.wantMuted) return true;
    if (!this.hasUserActivation()) {
      this.setBlocked(true);
      return true;
    }
    return false;
  }

  private setBlocked(blocked: boolean): void {
    if (this.blocked === blocked) return;
    this.blocked = blocked;
    this.emit('soundBlocked', blocked);
  }

  private volumeValue(): number {
    // Perceptual-ish curve: equal steps sound roughly equally louder.
    const x = Math.max(0, Math.min(1, this.level / VOLUME_STEPS));
    return x * x;
  }

  private updatePreload(): void {
    const n = this.videos.length;
    this.videos.forEach((v, i) => {
      const d = Math.min(Math.abs(i - this.current), n - Math.abs(i - this.current));
      const want = d <= 1 ? 'auto' : this.preloadAll && v.preload === 'auto' ? 'auto' : 'metadata';
      if (v.preload !== want) v.preload = want;
    });
  }

  private preloaded = false;
  private preloadEverything(): void {
    if (this.preloaded) return;
    this.preloaded = true;
    // Stagger so the neighbours win the bandwidth race.
    this.videos.forEach((v, i) => {
      window.setTimeout(() => {
        if (v.preload !== 'auto') v.preload = 'auto';
      }, 400 * i);
    });
  }
}

function pickSource(channel: Channel): string | null {
  const probe = document.createElement('video');
  for (const s of channel.sources) if (probe.canPlayType(s.type) === 'probably') return s.src;
  for (const s of channel.sources) if (probe.canPlayType(s.type) !== '') return s.src;
  return channel.sources[0]?.src ?? null;
}

/** iOS ignores `video.volume` entirely (hardware buttons only). */
function detectVolumeControl(): boolean {
  const v = document.createElement('video');
  try {
    v.volume = 0.5;
    return v.volume === 0.5;
  } catch {
    return false;
  }
}
