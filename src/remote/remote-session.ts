import { Emitter } from '../shared/emitter';
import { createLink, type Link, type LinkStatus } from '../shared/realtime/link';
import {
  VOLUME_STEPS,
  createClientId,
  describeDevice,
  type ErrorCode,
  type RemoteCommand,
  type TvState,
} from '../shared/protocol';

export interface RemoteView {
  link: LinkStatus;
  tvPresent: boolean;
  /** What the remote shows: the TV's last confirmed state with not-yet-acknowledged presses applied on top. */
  state: TvState | null;
  ended: boolean;
  error: ErrorCode | null;
}

type Events = {
  change: RemoteView;
  /** A press left the phone (blink the IR LED). */
  sent: RemoteCommand;
};

interface Pending {
  cid: number;
  cmd: RemoteCommand;
  at: number;
}

/** How long an unacknowledged press is allowed to override the TV's reported state. */
const PENDING_TTL_MS = 2500;

function storedClientId(): string {
  try {
    const existing = localStorage.getItem('remote.clientId');
    if (existing && /^[a-z0-9]{16}$/.test(existing)) return existing;
    const id = createClientId();
    localStorage.setItem('remote.clientId', id);
    return id;
  } catch {
    return createClientId();
  }
}

/**
 * Phone side of a pairing. Sends commands, and renders optimistically: each press is applied
 * locally right away, then reconciled when the TV's snapshot acknowledges it (`acks[clientId]`).
 * Unacknowledged presses are re-applied on top of every newer snapshot, so the display never
 * flickers back to an old value while the TV catches up.
 */
export class RemoteSession extends Emitter<Events> {
  readonly clientId = storedClientId();
  private link: Link;
  private confirmed: TvState | null = null;
  private pending: Pending[] = [];
  /** Monotonic across reloads so the TV's ack bookkeeping never goes backwards. */
  private cid = Date.now();
  private ended = false;
  private error: ErrorCode | null = null;
  private expiryTimer: number | undefined;

  constructor(readonly session: string) {
    super();
    this.link = createLink({ role: 'remote', session, clientId: this.clientId, label: describeDevice() });
    this.link.on('status', () => this.changed());
    this.link.on('presence', () => this.changed());
    this.link.on('state', (state) => {
      this.confirmed = state;
      const ack = state.acks?.[this.clientId] ?? 0;
      this.pending = this.pending.filter((p) => p.cid > ack);
      this.changed();
    });
    this.link.on('nack', ({ cid }) => {
      this.pending = this.pending.filter((p) => p.cid !== cid);
      this.changed();
    });
    this.link.on('ended', () => {
      this.ended = true;
      this.changed();
    });
    this.link.on('error', ({ code }) => {
      if (code === 'rate-limited') return;
      this.error = code;
      this.changed();
    });
    this.link.on('replaced', () => {
      // The same phone opened the remote in another tab; that one wins.
      this.error = 'session-in-use';
      this.changed();
    });
  }

  start(): void {
    this.link.connect();
  }

  get view(): RemoteView {
    let state = this.confirmed;
    if (state && this.pending.length) {
      state = structuredClone(state);
      for (const p of this.pending) applyOptimistic(state, p.cmd);
    }
    return {
      link: this.link.status,
      tvPresent: this.link.presence.tv,
      state,
      ended: this.ended,
      error: this.error,
    };
  }

  canSend(): boolean {
    return this.link.status === 'online' && this.link.presence.tv && !this.ended;
  }

  /** Returns false if the TV isn't reachable right now (the UI shakes the button). */
  send(cmd: RemoteCommand): boolean {
    if (!this.canSend()) {
      this.link.check();
      return false;
    }
    const cid = ++this.cid;
    if (!this.link.sendCommand(cid, cmd)) return false;
    this.pending.push({ cid, cmd, at: performance.now() });
    this.emit('sent', cmd);
    this.scheduleExpiry();
    this.changed();
    return true;
  }

  /** Verify the connection (called when the phone wakes up / the page becomes visible). */
  check(): void {
    this.link.check();
  }

  leave(): void {
    this.link.close('leave');
  }

  private scheduleExpiry(): void {
    window.clearTimeout(this.expiryTimer);
    this.expiryTimer = window.setTimeout(() => {
      const now = performance.now();
      const before = this.pending.length;
      this.pending = this.pending.filter((p) => now - p.at < PENDING_TTL_MS);
      if (this.pending.length !== before) this.changed();
      if (this.pending.length) this.scheduleExpiry();
    }, PENDING_TTL_MS);
  }

  private changed(): void {
    this.emit('change', this.view);
  }
}

/** Mirror of TvController's behaviour, just enough to predict the next display. */
function applyOptimistic(s: TvState, cmd: RemoteCommand): void {
  const n = s.lineup.length;
  switch (cmd.type) {
    case 'channel-step':
      if (!s.power) {
        s.power = true;
        break;
      }
      s.channel = (((s.channel + cmd.delta) % n) + n) % n;
      s.tuning = true;
      s.entry = null;
      break;
    case 'channel-set': {
      const i = s.lineup.findIndex((c) => c.number === cmd.number);
      if (i >= 0) {
        s.channel = i;
        s.power = true;
        s.tuning = true;
      }
      break;
    }
    case 'digit':
      s.entry = s.entry ? null : `${cmd.digit}-`;
      break;
    case 'play-toggle':
      if (s.power) s.playing = !s.playing;
      break;
    case 'mute-toggle':
      s.muted = !s.muted;
      break;
    case 'volume-step':
      s.volume = Math.max(0, Math.min(VOLUME_STEPS, s.volume + Math.sign(cmd.delta)));
      if (cmd.delta > 0 && s.muted && s.volume > 0) s.muted = false;
      break;
    case 'volume-set':
      s.volume = Math.max(0, Math.min(VOLUME_STEPS, cmd.level));
      break;
    case 'power-toggle':
      s.power = !s.power;
      break;
    case 'info':
      break;
  }
}
