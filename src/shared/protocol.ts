/**
 * Wire protocol shared by the TV (desktop) and the remote (phone).
 *
 * The TV is the single source of truth. Remotes send *commands*; the TV applies them and
 * broadcasts a full *state snapshot* back. Snapshots are small (~1–2 KB) and idempotent, so a
 * remote that reconnects, or misses a message, is always one snapshot away from being correct.
 *
 * The server (or Supabase channel) is only a relay with presence. It never interprets commands.
 * Keep `server/relay.js` in sync with the envelope types below.
 */

export const PROTOCOL_VERSION = 1;

/** Unambiguous alphabet: no 0/O, 1/I/L. Six characters ≈ 887 million codes. */
export const SESSION_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const SESSION_LENGTH = 6;
export const SESSION_RE = new RegExp(`^[${SESSION_ALPHABET}]{${SESSION_LENGTH}}$`);

export type Role = 'tv' | 'remote';

export const VOLUME_STEPS = 20;

export type RemoteCommand =
  | { type: 'channel-step'; delta: 1 | -1 }
  | { type: 'channel-set'; number: number }
  | { type: 'digit'; digit: number }
  | { type: 'play-toggle' }
  | { type: 'mute-toggle' }
  | { type: 'volume-step'; delta: number }
  | { type: 'volume-set'; level: number }
  | { type: 'power-toggle' }
  | { type: 'info' };

export interface ChannelSummary {
  id: string;
  number: number;
  client: string;
  title: string;
  category: string;
  year: number;
  poster: string;
}

export interface TvState {
  v: typeof PROTOCOL_VERSION;
  power: boolean;
  /** Index into `lineup`. */
  channel: number;
  playing: boolean;
  muted: boolean;
  /** 0…VOLUME_STEPS */
  volume: number;
  /** True while the TV's browser refuses to play audio until someone clicks the TV page. */
  soundBlocked: boolean;
  /** Direct channel entry in progress, e.g. "1-". */
  entry: string | null;
  /** True during a channel-change transition. */
  tuning: boolean;
  /** Highest command id processed per remote client id (for optimistic UI reconciliation). */
  acks: Record<string, number>;
  lineup: ChannelSummary[];
  /** Short TV label, shown on the remote ("Chrome on macOS"). */
  tvLabel: string;
}

export interface PeerInfo {
  id: string;
  label: string;
}

export interface Presence {
  tv: boolean;
  remotes: PeerInfo[];
}

/* ----- client → relay ------------------------------------------------------------------ */

export type ClientMessage =
  | { t: 'join'; v: number; role: Role; session: string; clientId: string; label: string }
  | { t: 'cmd'; cid: number; cmd: RemoteCommand }
  | { t: 'state'; state: TvState }
  | { t: 'ping'; ts: number }
  | { t: 'leave' }
  | { t: 'end' };

/* ----- relay → client ------------------------------------------------------------------ */

export type ErrorCode =
  | 'bad-request'
  | 'version'
  | 'session-in-use'
  | 'room-full'
  | 'rate-limited'
  | 'not-joined'
  | 'origin';

export type ServerMessage =
  | { t: 'welcome'; session: string; role: Role; clientId: string; presence: Presence }
  | { t: 'presence'; presence: Presence }
  | { t: 'cmd'; from: string; cid: number; cmd: RemoteCommand }
  | { t: 'state'; state: TvState }
  | { t: 'pong'; ts: number }
  | { t: 'nack'; cid: number; reason: 'tv-offline' }
  | { t: 'ended'; reason: 'tv-ended' }
  | { t: 'replaced' }
  | { t: 'error'; code: ErrorCode; message: string };

/* ----- helpers ------------------------------------------------------------------------- */

export function randomString(length: number, alphabet: string): string {
  const out: string[] = [];
  const max = 256 - (256 % alphabet.length); // rejection sampling → no modulo bias
  const buf = new Uint8Array(length * 2);
  while (out.length < length) {
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < max) out.push(alphabet[b % alphabet.length]);
      if (out.length === length) break;
    }
  }
  return out.join('');
}

export function createSessionId(): string {
  return randomString(SESSION_LENGTH, SESSION_ALPHABET);
}

export function createClientId(): string {
  return randomString(16, 'abcdefghijklmnopqrstuvwxyz0123456789');
}

/** Accepts user input like "abc-123" or " a b c 1 2 3" and returns a canonical id, or null. */
export function normalizeSessionId(input: string | null | undefined): string | null {
  if (!input) return null;
  const cleaned = input.toUpperCase().replace(/[\s\-_.]/g, '');
  return SESSION_RE.test(cleaned) ? cleaned : null;
}

export function formatChannelNumber(n: number): string {
  return n.toString().padStart(2, '0');
}

/** Short human-readable device label, e.g. "Safari · iPhone". */
export function describeDevice(ua = navigator.userAgent): string {
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /CriOS|Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser';
  const device = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? /Mobile/.test(ua)
          ? 'Android phone'
          : 'Android tablet'
        : /Mac OS X/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'Device';
  return `${browser} · ${device}`;
}
