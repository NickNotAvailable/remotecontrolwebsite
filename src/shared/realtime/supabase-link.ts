import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { Emitter } from '../emitter';
import type { PeerInfo, Presence, RemoteCommand, TvState } from '../protocol';
import type { Link, LinkEvents, LinkOptions, LinkStatus } from './link';

interface PresenceMeta {
  role: 'tv' | 'remote';
  label: string;
  joinedAt: number;
}

/**
 * Supabase Realtime transport (Broadcast + Presence). No database tables are needed.
 * Use it when the site is deployed as static files (Vercel, Netlify…) with no Node relay.
 *
 *   channel:   `tv:<SESSION>`
 *   presence:  keyed by clientId, meta { role, label, joinedAt }
 *   broadcast: `cmd` (remote → tv), `state` (tv → remotes), `ended` (tv → remotes)
 *
 * supabase-js handles heartbeats and re-joining by itself; we map its channel status onto ours.
 * The SDK is loaded lazily so the default WebSocket build never downloads it.
 */
export class SupabaseLink extends Emitter<LinkEvents> implements Link {
  readonly transport = 'supabase' as const;
  readonly role;
  readonly session;
  readonly clientId;
  status: LinkStatus = 'connecting';
  presence: Presence = { tv: false, remotes: [] };

  private client: SupabaseClient | null = null;
  private channel: RealtimeChannel | null = null;
  private joinedAt = Date.now();
  private closed = false;
  private readonly label: string;

  constructor(
    options: LinkOptions,
    private readonly url: string,
    private readonly anonKey: string,
  ) {
    super();
    this.role = options.role;
    this.session = options.session;
    this.clientId = options.clientId;
    this.label = options.label;
  }

  connect(): void {
    this.closed = false;
    void this.start();
  }

  private async start(): Promise<void> {
    this.setStatus('connecting');
    const { createClient } = await import('@supabase/supabase-js');
    if (this.closed) return;
    this.client = createClient(this.url, this.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 30 } },
    });
    const channel = this.client.channel(`tv:${this.session}`, {
      config: { broadcast: { self: false, ack: false }, presence: { key: this.clientId } },
    });
    this.channel = channel;

    channel.on('broadcast', { event: 'cmd' }, ({ payload }) => {
      if (this.role !== 'tv') return;
      const p = payload as { from: string; cid: number; cmd: RemoteCommand };
      if (p && typeof p.cid === 'number' && p.cmd) this.emit('cmd', p);
    });
    channel.on('broadcast', { event: 'state' }, ({ payload }) => {
      if (this.role === 'remote' && payload?.state) this.emit('state', payload.state as TvState);
    });
    channel.on('broadcast', { event: 'ended' }, () => {
      if (this.role !== 'remote') return;
      this.emit('ended', { reason: 'tv-ended' });
      this.close();
    });
    channel.on('presence', { event: 'sync' }, () => this.syncPresence());

    channel.subscribe(async (status) => {
      if (this.closed) return;
      if (status === 'SUBSCRIBED') {
        this.joinedAt = Date.now();
        await channel.track({ role: this.role, label: this.label, joinedAt: this.joinedAt } satisfies PresenceMeta);
        this.setStatus('online');
        this.syncPresence();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        this.setStatus('offline');
      }
    });
  }

  private syncPresence(): void {
    if (!this.channel) return;
    const state = this.channel.presenceState<PresenceMeta>();
    let tv = false;
    let olderTv = false;
    const remotes: PeerInfo[] = [];
    for (const [key, metas] of Object.entries(state)) {
      const meta = metas[0];
      if (!meta) continue;
      if (meta.role === 'tv') {
        if (key !== this.clientId) {
          tv = true;
          if (meta.joinedAt < this.joinedAt) olderTv = true;
        } else if (this.role === 'tv') {
          tv = true;
        }
      } else if (key !== this.clientId) {
        remotes.push({ id: key, label: meta.label });
      }
    }
    if (this.role === 'tv' && olderTv) {
      // Somebody else already owns this code; let the TV pick a fresh one.
      this.emit('error', { code: 'session-in-use', message: 'Another screen is using this pairing code.' });
      this.close();
      return;
    }
    this.presence = { tv, remotes };
    this.emit('presence', this.presence);
  }

  sendCommand(cid: number, cmd: RemoteCommand): boolean {
    return this.broadcast('cmd', { from: this.clientId, cid, cmd });
  }

  publishState(state: TvState): boolean {
    return this.broadcast('state', { state });
  }

  close(mode?: 'leave' | 'end'): void {
    if (this.closed) return;
    if (mode === 'end') this.broadcast('ended', { reason: 'tv-ended' });
    this.closed = true;
    const channel = this.channel;
    const client = this.client;
    this.channel = null;
    if (channel) {
      void channel.untrack().finally(() => {
        if (client) void client.removeChannel(channel);
      });
    }
    this.setStatus('closed');
  }

  check(): void {
    /* supabase-js runs its own heartbeat + rejoin loop */
  }

  private broadcast(event: string, payload: Record<string, unknown>): boolean {
    if (!this.channel || this.status !== 'online') return false;
    void this.channel.send({ type: 'broadcast', event, payload });
    return true;
  }

  private setStatus(status: LinkStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.emit('status', status);
  }
}
