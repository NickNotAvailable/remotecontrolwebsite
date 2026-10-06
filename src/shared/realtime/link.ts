import type { Emitter } from '../emitter';
import type { ErrorCode, Presence, RemoteCommand, Role, TvState } from '../protocol';
import { config, relayUrl } from '../config';
import { WsLink } from './ws-link';
import { SupabaseLink } from './supabase-link';

/**
 * A `Link` is one device's membership in one pairing session, independent of the transport.
 *
 *   status:    connecting → online ⇄ offline … closed
 *   presence:  who else is in the session (is the TV there? which remotes?)
 *   tv side:   receives `cmd`, calls `publishState()`
 *   remote:    calls `sendCommand()`, receives `state`
 */
export type LinkStatus = 'connecting' | 'online' | 'offline' | 'closed';

export type LinkEvents = {
  status: LinkStatus;
  presence: Presence;
  cmd: { from: string; cid: number; cmd: RemoteCommand };
  state: TvState;
  nack: { cid: number; reason: string };
  ended: { reason: string };
  replaced: undefined;
  error: { code: ErrorCode; message: string };
};

export interface LinkOptions {
  role: Role;
  session: string;
  clientId: string;
  label: string;
}

export interface Link extends Pick<Emitter<LinkEvents>, 'on'> {
  readonly role: Role;
  readonly session: string;
  readonly clientId: string;
  readonly status: LinkStatus;
  readonly presence: Presence;
  readonly transport: 'ws' | 'supabase';
  connect(): void;
  sendCommand(cid: number, cmd: RemoteCommand): boolean;
  publishState(state: TvState): boolean;
  /** `leave` = polite goodbye (remote), `end` = TV ends the session for everyone. */
  close(mode?: 'leave' | 'end'): void;
  /** Verify the connection is still alive right now (phone woke up, network changed…). */
  check(): void;
}

export function createLink(options: LinkOptions): Link {
  if (config.realtimeProvider === 'supabase') {
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      console.error(
        '[realtime] VITE_REALTIME_PROVIDER=supabase but VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are missing. ' +
          'Falling back to the WebSocket relay.',
      );
    } else {
      return new SupabaseLink(options, config.supabaseUrl, config.supabaseAnonKey);
    }
  }
  return new WsLink(options, relayUrl());
}
