import { Emitter } from '../emitter';
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type Presence,
  type RemoteCommand,
  type ServerMessage,
  type TvState,
} from '../protocol';
import type { Link, LinkEvents, LinkOptions, LinkStatus } from './link';

const PING_EVERY_MS = 10_000;
/** No traffic for this long → assume the socket is dead (common after a phone sleeps). */
const SILENCE_LIMIT_MS = 25_000;
/** After an explicit `check()`, the relay must answer within this window. */
const CHECK_DEADLINE_MS = 4_000;
const MAX_BACKOFF_MS = 8_000;

const TERMINAL_ERRORS = new Set(['session-in-use', 'room-full', 'version', 'origin', 'bad-request']);

/** WebSocket transport for the bundled relay (`server/relay.js`). Reconnects forever until closed. */
export class WsLink extends Emitter<LinkEvents> implements Link {
  readonly transport = 'ws' as const;
  readonly role;
  readonly session;
  readonly clientId;
  status: LinkStatus = 'connecting';
  presence: Presence = { tv: false, remotes: [] };

  private ws: WebSocket | null = null;
  private attempts = 0;
  private terminal = false;
  /** Once we've been online, retries report `offline` (reconnecting) rather than `connecting`. */
  private everOnline = false;
  private lastRx = 0;
  private deadline = 0;
  private retryTimer: number | undefined;
  private pingTimer: number | undefined;
  private watchdogTimer: number | undefined;
  private readonly label: string;

  constructor(
    options: LinkOptions,
    private readonly url: string,
  ) {
    super();
    this.role = options.role;
    this.session = options.session;
    this.clientId = options.clientId;
    this.label = options.label;
  }

  connect(): void {
    this.terminal = false;
    window.addEventListener('online', this.onWake);
    window.addEventListener('pageshow', this.onWake);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.open();
  }

  sendCommand(cid: number, cmd: RemoteCommand): boolean {
    return this.send({ t: 'cmd', cid, cmd });
  }

  publishState(state: TvState): boolean {
    return this.send({ t: 'state', state });
  }

  close(mode?: 'leave' | 'end'): void {
    if (this.terminal && this.status === 'closed') return;
    if (mode) this.send({ t: mode });
    this.shutdown();
  }

  check(): void {
    if (this.terminal) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send({ t: 'ping', ts: Date.now() });
      this.deadline = Date.now() + CHECK_DEADLINE_MS;
    } else if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      // Skip the remaining back-off: the user is looking at the screen right now.
      this.attempts = 0;
      this.open();
    }
  }

  /* ------------------------------------------------------------------------------------- */

  private onWake = () => this.check();
  private onVisibility = () => {
    if (document.visibilityState === 'visible') this.check();
  };

  private send(msg: ClientMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    if (msg.t !== 'join' && msg.t !== 'ping' && this.status !== 'online') return false;
    try {
      this.ws.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  private open(): void {
    this.clearTimers();
    this.detach();
    this.setStatus(this.everOnline ? 'offline' : 'connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (err) {
      console.warn('[ws-link] could not create socket', err);
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.lastRx = Date.now();
      ws.send(
        JSON.stringify({
          t: 'join',
          v: PROTOCOL_VERSION,
          role: this.role,
          session: this.session,
          clientId: this.clientId,
          label: this.label,
        } satisfies ClientMessage),
      );
      this.pingTimer = window.setInterval(() => this.send({ t: 'ping', ts: Date.now() }), PING_EVERY_MS);
      this.watchdogTimer = window.setInterval(this.watchdog, 1_000);
    };
    ws.onmessage = (event) => {
      this.lastRx = Date.now();
      this.deadline = 0;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      this.handle(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.clearTimers();
      if (this.terminal) {
        this.setStatus('closed');
      } else {
        this.setStatus('offline');
        this.scheduleRetry();
      }
    };
    ws.onerror = () => {
      /* a close event always follows */
    };
  }

  private watchdog = () => {
    const now = Date.now();
    const silent = now - this.lastRx > SILENCE_LIMIT_MS;
    const missedDeadline = this.deadline > 0 && now > this.deadline;
    if (silent || missedDeadline) {
      console.info('[ws-link] connection went quiet, reconnecting');
      this.deadline = 0;
      this.detach();
      this.clearTimers();
      this.setStatus('offline');
      this.scheduleRetry(true);
    }
  };

  private handle(msg: ServerMessage): void {
    switch (msg.t) {
      case 'welcome':
        this.attempts = 0;
        this.everOnline = true;
        this.presence = msg.presence;
        this.setStatus('online');
        this.emit('presence', this.presence);
        break;
      case 'presence':
        this.presence = msg.presence;
        this.emit('presence', this.presence);
        break;
      case 'cmd':
        if (this.role === 'tv') this.emit('cmd', { from: msg.from, cid: msg.cid, cmd: msg.cmd });
        break;
      case 'state':
        if (this.role === 'remote') this.emit('state', msg.state);
        break;
      case 'nack':
        this.emit('nack', { cid: msg.cid, reason: msg.reason });
        break;
      case 'ended':
        this.terminal = true;
        this.emit('ended', { reason: msg.reason });
        this.shutdown();
        break;
      case 'replaced':
        this.terminal = true;
        this.emit('replaced', undefined);
        this.shutdown();
        break;
      case 'error':
        if (TERMINAL_ERRORS.has(msg.code)) this.terminal = true;
        this.emit('error', { code: msg.code, message: msg.message });
        if (this.terminal) this.shutdown();
        break;
      case 'pong':
        break;
    }
  }

  private scheduleRetry(immediate = false): void {
    if (this.terminal) return;
    window.clearTimeout(this.retryTimer);
    const base = immediate ? 150 : Math.min(MAX_BACKOFF_MS, 400 * 2 ** this.attempts);
    const delay = base * (0.75 + Math.random() * 0.5);
    this.attempts = Math.min(this.attempts + 1, 10);
    this.retryTimer = window.setTimeout(() => this.open(), delay);
  }

  private shutdown(): void {
    this.terminal = true;
    window.removeEventListener('online', this.onWake);
    window.removeEventListener('pageshow', this.onWake);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.clearTimers();
    window.clearTimeout(this.retryTimer);
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.onmessage = null;
      try {
        ws.close(1000, 'bye');
      } catch {
        /* ignore */
      }
    }
    this.setStatus('closed');
  }

  private detach(): void {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }

  private clearTimers(): void {
    window.clearInterval(this.pingTimer);
    window.clearInterval(this.watchdogTimer);
    this.pingTimer = this.watchdogTimer = undefined;
  }

  private setStatus(status: LinkStatus): void {
    if (this.status === status) return;
    this.status = status;
    if (status !== 'online') {
      // We can't vouch for anyone while we're not connected.
      if (this.presence.tv || this.presence.remotes.length) {
        this.presence = { tv: false, remotes: [] };
        this.emit('presence', this.presence);
      }
    }
    this.emit('status', status);
  }
}
