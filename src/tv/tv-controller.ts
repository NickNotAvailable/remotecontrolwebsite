import { channels, lineup } from '../data/channels';
import { Emitter } from '../shared/emitter';
import { PROTOCOL_VERSION, VOLUME_STEPS, describeDevice, type RemoteCommand, type TvState } from '../shared/protocol';
import { Fx, POWER_OFF_HOLD, SURF_FROM, channelChangeTimeline, powerOffTimeline, powerOnTimeline } from './fx';
import type { ChannelPlayer } from './player';
import type { Renderer } from './renderer/types';
import type { Sfx } from './sfx';

export type Source = 'local' | 'remote';

type ControllerEvents = {
  /** Any state change. UI re-renders from `state`; pairing publishes it to remotes. */
  change: TvState;
  /** Channel change began (OSD shows the new number immediately). */
  tuneStart: { index: number; source: Source };
  /** The new picture is locking in: show the project graphics. */
  tuneReveal: { index: number };
  volume: { level: number; muted: boolean; source: Source };
  info: undefined;
  remoteCommand: { from: string; cmd: RemoteCommand };
  power: boolean;
};

const DIGIT_TIMEOUT_MS = 1600;

/** The TV's brain: owns the state and turns intents (keyboard, buttons, remote) into effects. */
export class TvController extends Emitter<ControllerEvents> {
  state: TvState;
  private renderer: Renderer;
  private displayed = -1;
  private tuneToken = 0;
  private digitTimer: number | undefined;
  private digitBuffer = '';
  private publishQueued = false;
  private buffering = false;
  /** Has anyone ever asked for sound? Drives the "click for sound" prompt. */
  everUnmuted = false;

  constructor(
    private readonly player: ChannelPlayer,
    private readonly fx: Fx,
    renderer: Renderer,
    private readonly sfx: Sfx,
    initialChannel = 0,
  ) {
    super();
    this.renderer = renderer;
    this.state = {
      v: PROTOCOL_VERSION,
      power: true,
      channel: initialChannel,
      playing: true,
      muted: true,
      volume: 12,
      soundBlocked: false,
      entry: null,
      tuning: false,
      acks: {},
      lineup: lineup(),
      tvLabel: describeDevice(),
    };

    player.on('soundBlocked', (blocked) => {
      this.state.soundBlocked = blocked;
      this.syncSfx();
      this.changed();
    });
    player.on('buffering', ({ index, buffering }) => {
      if (index !== this.state.channel) return;
      this.buffering = buffering;
      this.updateAmbient();
    });
    player.on('error', ({ index }) => {
      if (index === this.state.channel) this.updateAmbient();
    });

    player.setVolume(this.state.volume);
    player.tune(initialChannel);
    this.displayed = initialChannel;
    this.renderer.setSource(player.videos[initialChannel]);
    this.syncSfx();
  }

  get channel() {
    return channels[this.state.channel];
  }

  channelFailed(): boolean {
    return this.player.hasFailed;
  }

  /** Swap renderers at runtime (WebGL → DOM fallback). */
  useRenderer(renderer: Renderer): void {
    this.renderer = renderer;
    renderer.setSource(this.player.videos[this.displayed] ?? null);
  }

  /* ----- actions ------------------------------------------------------------------------ */

  tuneTo(index: number, source: Source = 'local'): void {
    const n = channels.length;
    index = ((index % n) + n) % n;
    if (!this.state.power) {
      this.state.channel = index;
      this.setPower(true, source);
      return;
    }
    this.clearDigits();
    if (index === this.state.channel && !this.state.tuning) {
      this.emit('tuneStart', { index, source });
      this.emit('tuneReveal', { index });
      return;
    }
    const token = ++this.tuneToken;
    const surfing = this.fx.busy && this.state.tuning;
    this.state.channel = index;
    this.state.tuning = true;
    this.buffering = false;
    // A new channel is "live": changing channel always resumes playback.
    if (!this.state.playing) {
      this.state.playing = true;
      this.player.setPlaying(true);
    }
    this.player.tune(index);
    this.sfx.staticBurst(surfing ? 420 : 560);
    this.emit('tuneStart', { index, source });
    this.changed();

    void this.fx
      .run(channelChangeTimeline(), {
        from: surfing ? SURF_FROM : 0,
        onMark: (mark) => {
          if (token !== this.tuneToken) return;
          if (mark === 'cut') {
            const target = this.state.channel;
            this.renderer.setSource(this.player.videos[target]);
            this.displayed = target;
            this.player.videos.forEach((_, i) => i !== target && this.player.release(i));
          } else if (mark === 'reveal') {
            this.updateAmbient();
            this.emit('tuneReveal', { index: this.state.channel });
          }
        },
      })
      .then(() => {
        if (token !== this.tuneToken) return;
        this.state.tuning = false;
        this.changed();
      });
  }

  step(delta: 1 | -1, source: Source = 'local'): void {
    this.tuneTo(this.state.channel + delta, source);
  }

  /** Number-pad entry with the classic "1-" pending state. */
  digit(d: number, source: Source = 'local'): void {
    if (!Number.isInteger(d) || d < 0 || d > 9) return;
    const max = Math.max(...channels.map((c) => c.number));
    this.digitBuffer += String(d);
    const value = parseInt(this.digitBuffer, 10);
    window.clearTimeout(this.digitTimer);
    if (this.digitBuffer.length >= 2 || value * 10 > max) {
      this.commitDigits(source);
    } else {
      this.state.entry = `${this.digitBuffer}-`;
      this.changed();
      this.digitTimer = window.setTimeout(() => this.commitDigits(source), DIGIT_TIMEOUT_MS);
    }
  }

  setChannelNumber(number: number, source: Source = 'local'): void {
    const index = channels.findIndex((c) => c.number === number);
    if (index >= 0) this.tuneTo(index, source);
  }

  setPlaying(playing: boolean, _source: Source = 'local'): void {
    if (!this.state.power) return;
    this.state.playing = playing;
    this.player.setPlaying(playing);
    this.updateAmbient();
    this.changed();
  }

  togglePlay(source: Source = 'local'): void {
    this.setPlaying(!this.state.playing, source);
  }

  setMuted(muted: boolean, source: Source = 'local'): void {
    this.sfx.unlock();
    if (!muted) this.everUnmuted = true;
    this.state.muted = muted;
    this.player.setMuted(muted);
    this.state.soundBlocked = this.player.soundBlocked;
    this.syncSfx();
    this.emit('volume', { level: this.state.volume, muted, source });
    this.changed();
  }

  toggleMute(source: Source = 'local'): void {
    this.setMuted(!this.state.muted, source);
  }

  setVolume(level: number, source: Source = 'local', unmute = true): void {
    level = Math.round(Math.min(VOLUME_STEPS, Math.max(0, level)));
    this.state.volume = level;
    this.player.setVolume(level);
    if (unmute && this.state.muted && level > 0) {
      this.setMuted(false, source); // volume up on a muted TV unmutes it, like the real thing
      return;
    }
    this.syncSfx();
    this.emit('volume', { level, muted: this.state.muted, source });
    this.changed();
  }

  stepVolume(delta: number, source: Source = 'local'): void {
    this.setVolume(this.state.volume + delta, source, delta > 0);
  }

  setPower(on: boolean, _source: Source = 'local'): void {
    if (this.state.power === on) return;
    this.clearDigits();
    this.state.power = on;
    const token = ++this.tuneToken;
    if (on) {
      const index = this.state.channel;
      this.player.wake();
      this.player.tune(index);
      this.renderer.setSource(this.player.videos[index]);
      this.displayed = index;
      this.player.videos.forEach((_, i) => i !== index && this.player.release(i));
      this.sfx.powerOn();
      this.state.tuning = true;
      void this.fx
        .run(powerOnTimeline(), {
          onMark: (m) => m === 'picture' && token === this.tuneToken && this.emit('tuneStart', { index, source: _source }),
        })
        .then(() => {
          if (token !== this.tuneToken) return;
          this.state.tuning = false;
          this.updateAmbient();
          this.emit('tuneReveal', { index: this.state.channel });
          this.changed();
        });
    } else {
      this.sfx.powerOff();
      this.state.tuning = false;
      this.fx.ambientNoise = 0;
      this.fx.ambientTracking = 0;
      void this.fx.run(powerOffTimeline(), { hold: POWER_OFF_HOLD }).then(() => {
        if (!this.state.power) this.player.standby();
      });
    }
    this.syncSfx();
    this.emit('power', on);
    this.changed();
  }

  togglePower(source: Source = 'local'): void {
    this.setPower(!this.state.power, source);
  }

  showInfo(): void {
    this.emit('info', undefined);
  }

  /** Entry point for commands relayed from a paired phone. */
  handleRemoteCommand(from: string, cid: number, cmd: RemoteCommand): void {
    this.state.acks[from] = Math.max(this.state.acks[from] ?? 0, cid);
    this.emit('remoteCommand', { from, cmd });
    switch (cmd.type) {
      case 'channel-step':
        this.step(cmd.delta === -1 ? -1 : 1, 'remote');
        break;
      case 'channel-set':
        this.setChannelNumber(Number(cmd.number), 'remote');
        break;
      case 'digit':
        if (!this.state.power) this.setPower(true, 'remote');
        this.digit(Number(cmd.digit), 'remote');
        break;
      case 'play-toggle':
        this.togglePlay('remote');
        break;
      case 'mute-toggle':
        this.toggleMute('remote');
        break;
      case 'volume-step':
        this.stepVolume(Math.sign(Number(cmd.delta)) || 0, 'remote');
        break;
      case 'volume-set':
        this.setVolume(Number(cmd.level), 'remote');
        break;
      case 'power-toggle':
        this.togglePower('remote');
        break;
      case 'info':
        this.showInfo();
        break;
    }
    // Always answer, even for no-ops, so the remote's optimistic UI reconciles.
    this.changed();
  }

  forgetRemote(id: string): void {
    delete this.state.acks[id];
  }

  /* ------------------------------------------------------------------------------------- */

  private commitDigits(source: Source): void {
    const value = parseInt(this.digitBuffer, 10);
    this.clearDigits();
    this.changed();
    if (!Number.isNaN(value)) this.setChannelNumber(value, source);
  }

  private clearDigits(): void {
    window.clearTimeout(this.digitTimer);
    this.digitBuffer = '';
    this.state.entry = null;
  }

  private updateAmbient(): void {
    if (!this.state.power) return;
    const failed = this.player.hasFailed;
    this.fx.ambientNoise = failed ? 0.9 : this.buffering && !this.state.tuning ? 0.16 : 0;
    this.fx.ambientTracking = failed ? 0 : !this.state.playing ? 0.55 : this.buffering ? 0.4 : 0;
  }

  private syncSfx(): void {
    const x = this.state.volume / VOLUME_STEPS;
    this.sfx.setOutput(x * x, !this.state.muted && !this.state.soundBlocked && this.state.power);
  }

  /** Coalesce bursts of changes into one event per microtask. */
  private changed(): void {
    if (this.publishQueued) return;
    this.publishQueued = true;
    queueMicrotask(() => {
      this.publishQueued = false;
      this.emit('change', this.state);
    });
  }
}
