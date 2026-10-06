import { config } from '../shared/config';
import { Emitter } from '../shared/emitter';
import { createLink, type Link, type LinkStatus } from '../shared/realtime/link';
import {
  createClientId,
  createSessionId,
  describeDevice,
  normalizeSessionId,
  type PeerInfo,
  type TvState,
} from '../shared/protocol';
import type { TvController } from './tv-controller';

type PairingEvents = {
  status: LinkStatus;
  session: string;
  remotes: PeerInfo[];
  joined: PeerInfo;
  left: PeerInfo;
};

const PUBLISH_INTERVAL_MS = 80;

function storageGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function storageSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* private mode etc. — pairing still works, it just won't survive a reload */
  }
}

/**
 * TV side of the phone pairing. Owns the session code, keeps the link alive, applies incoming
 * commands to the controller and streams state snapshots back.
 *
 * The code is kept in sessionStorage so reloading the TV tab keeps phones paired.
 */
export class TvPairing extends Emitter<PairingEvents> {
  session: string;
  private clientId: string;
  private link: Link | null = null;
  private known = new Map<string, PeerInfo>();
  private lastPublish = 0;
  private publishTimer: number | undefined;
  base = location.origin;
  note: string | null = null;

  constructor(private readonly tv: TvController) {
    super();
    this.clientId = storageGet('tv.clientId') ?? createClientId();
    storageSet('tv.clientId', this.clientId);
    this.session = normalizeSessionId(storageGet('tv.session')) ?? createSessionId();
    storageSet('tv.session', this.session);
    tv.on('change', (state) => this.publish(state));
  }

  get status(): LinkStatus {
    return this.link?.status ?? 'connecting';
  }

  get remotes(): PeerInfo[] {
    return [...this.known.values()];
  }

  get transport(): string {
    return this.link?.transport ?? config.realtimeProvider;
  }

  pairUrl(): string {
    return `${this.base}/remote?session=${this.session}`;
  }

  async start(): Promise<void> {
    await this.resolveBase();
    this.emit('session', this.session); // the QR code can now use the phone-reachable URL
    this.connect();
  }

  /** Disconnect every phone and issue a fresh code. */
  newCode(): void {
    this.rotate(true);
  }

  /* ------------------------------------------------------------------------------------- */

  private connect(): void {
    const link = createLink({ role: 'tv', session: this.session, clientId: this.clientId, label: describeDevice() });
    this.link = link;
    link.on('status', (status) => {
      if (link !== this.link) return;
      this.emit('status', status);
      if (status === 'online') this.flush();
    });
    link.on('presence', (presence) => {
      if (link !== this.link) return;
      this.syncRemotes(presence.remotes);
    });
    link.on('cmd', ({ from, cid, cmd }) => {
      if (link !== this.link) return;
      this.tv.handleRemoteCommand(from, cid, cmd);
    });
    link.on('error', ({ code }) => {
      if (link !== this.link) return;
      if (code === 'session-in-use') {
        console.info('[pairing] code already taken, picking a new one');
        this.rotate(false);
      }
    });
    link.on('replaced', () => {
      if (link !== this.link) return;
      // Another tab took over our identity (e.g. "Duplicate tab" copies sessionStorage).
      this.clientId = createClientId();
      storageSet('tv.clientId', this.clientId);
      this.rotate(false);
    });
    link.connect();
  }

  private rotate(endCurrent: boolean): void {
    const old = this.link;
    this.link = null;
    old?.close(endCurrent ? 'end' : undefined);
    this.syncRemotes([]);
    this.session = createSessionId();
    storageSet('tv.session', this.session);
    this.emit('session', this.session);
    this.connect();
  }

  private syncRemotes(remotes: PeerInfo[]): void {
    const next = new Map(remotes.map((r) => [r.id, r]));
    let joined = false;
    for (const [id, info] of next) {
      if (!this.known.has(id)) {
        joined = true;
        this.emit('joined', info);
      }
    }
    for (const [id, info] of this.known) {
      if (!next.has(id)) {
        this.tv.forgetRemote(id);
        this.emit('left', info);
      }
    }
    this.known = next;
    this.emit('remotes', this.remotes);
    if (joined) this.flush();
  }

  private publish(_state: TvState): void {
    const wait = this.lastPublish + PUBLISH_INTERVAL_MS - performance.now();
    if (wait <= 0) this.flush();
    else if (this.publishTimer === undefined) this.publishTimer = window.setTimeout(() => this.flush(), wait);
  }

  private flush(): void {
    window.clearTimeout(this.publishTimer);
    this.publishTimer = undefined;
    this.lastPublish = performance.now();
    this.link?.publishState(this.tv.state);
  }

  /** Work out a URL that a phone can actually open. */
  private async resolveBase(): Promise<void> {
    if (config.publicUrl) {
      this.base = config.publicUrl;
      return;
    }
    const local = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/.test(location.hostname);
    try {
      const res = await fetch('/api/network', { cache: 'no-store' });
      if (res.ok && res.headers.get('content-type')?.includes('json')) {
        const info = (await res.json()) as { publicUrl: string | null; lanUrls: string[] };
        if (info.publicUrl) {
          this.base = info.publicUrl;
          return;
        }
        if (local && info.lanUrls.length) {
          this.base = info.lanUrls[0];
          this.note = 'Your phone needs to be on the same Wi-Fi as this computer.';
          return;
        }
      }
    } catch {
      /* static hosting: no API, use the page origin */
    }
    this.base = location.origin;
    if (local) this.note = 'Opened via localhost — phones can’t reach this address. Use your computer’s network IP.';
  }
}
