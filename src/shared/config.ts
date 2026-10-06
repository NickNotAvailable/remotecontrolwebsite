/**
 * Runtime configuration, read from Vite env variables (see `.env.example`).
 * Everything has a working default: with no `.env` at all the app uses the bundled WebSocket relay.
 */
const env = import.meta.env;

export type RealtimeProvider = 'ws' | 'supabase';

export const config = {
  realtimeProvider: (env.VITE_REALTIME_PROVIDER === 'supabase' ? 'supabase' : 'ws') as RealtimeProvider,
  /** Full ws(s):// URL of the relay. Empty → same origin as the page, path `/rc`. */
  wsUrl: env.VITE_WS_URL ?? '',
  /** Base URL encoded into the pairing QR code. Empty → auto-detected. */
  publicUrl: (env.VITE_PUBLIC_URL ?? '').replace(/\/+$/, ''),
  supabaseUrl: env.VITE_SUPABASE_URL ?? '',
  supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY ?? '',
  /** `VITE_PAIRING=off` builds a TV-only site (static previews with no relay to talk to). */
  pairing: env.VITE_PAIRING !== 'off',
};

export function relayUrl(): string {
  if (config.wsUrl) return config.wsUrl;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/rc`;
}
