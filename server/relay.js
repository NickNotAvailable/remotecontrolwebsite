// @ts-check
/**
 * Pairing relay: one "room" per TV session, containing the TV and up to N remotes.
 *
 * The relay is deliberately dumb: it validates envelopes, tracks presence, caches the TV's last
 * state snapshot (so a freshly connected phone renders instantly) and forwards
 *   remote → TV:      { t: 'cmd' }
 *   TV → remotes:     { t: 'state' }
 * It never interprets commands. Protocol types live in src/shared/protocol.ts.
 */
import { WebSocketServer, WebSocket } from 'ws';

const PROTOCOL_VERSION = 1;
const SESSION_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
const CLIENT_ID_RE = /^[a-zA-Z0-9_-]{6,64}$/;

/**
 * @typedef {{ id: string, label: string }} PeerInfo
 * @typedef {{
 *   ws: WebSocket, ip: string, role: 'tv' | 'remote' | null, session: string | null,
 *   clientId: string | null, label: string, tokens: number, lastRefill: number,
 *   alive: boolean, warnedAt: number
 * }} Client
 * @typedef {{
 *   id: string, tv: Client | null, remotes: Map<string, Client>, lastState: unknown,
 *   tvLeftAt: number, createdAt: number
 * }} Room
 */

/**
 * @param {{
 *   maxRemotes?: number, roomTtlMs?: number, allowedOrigins?: string[],
 *   maxConnectionsPerIp?: number, trustProxy?: boolean, log?: Pick<Console, 'info' | 'warn'>
 * }} [options]
 */
export function createRelay(options = {}) {
  const {
    maxRemotes = 6,
    roomTtlMs = 15 * 60_000, // keep a TV-less room around this long (TV reloads, laptop sleeps)
    allowedOrigins = [],
    maxConnectionsPerIp = 40,
    trustProxy = false,
    log = console,
  } = options;

  /**
   * Client IP for per-IP limits. Only believe forwarding headers behind a proxy you control
   * (Cloudflare Tunnel sets CF-Connecting-IP; most others X-Forwarded-For).
   */
  const ipOf = (/** @type {import('node:http').IncomingMessage} */ req) =>
    (trustProxy &&
      (String(req.headers['cf-connecting-ip'] || '').trim() ||
        String(req.headers['x-forwarded-for'] || '').split(',')[0].trim())) ||
    req.socket.remoteAddress ||
    '';

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  /** @type {Map<string, Room>} */
  const rooms = new Map();
  /** @type {Map<string, number>} */
  const perIp = new Map();
  /** @type {WeakMap<WebSocket, Client>} */
  const clientOf = new WeakMap();

  /** @param {Client} client @param {object} msg */
  function send(client, msg) {
    if (client.ws.readyState === WebSocket.OPEN) client.ws.send(JSON.stringify(msg));
  }

  /** @param {Room} room @returns {{ tv: boolean, remotes: PeerInfo[] }} */
  function presenceOf(room) {
    return {
      tv: !!room.tv,
      remotes: [...room.remotes.values()].map((c) => ({ id: /** @type {string} */ (c.clientId), label: c.label })),
    };
  }

  /** @param {Room} room */
  function broadcastPresence(room) {
    const msg = { t: 'presence', presence: presenceOf(room) };
    if (room.tv) send(room.tv, msg);
    for (const remote of room.remotes.values()) send(remote, msg);
  }

  /** @param {string} id @returns {Room} */
  function getRoom(id) {
    let room = rooms.get(id);
    if (!room) {
      room = { id, tv: null, remotes: new Map(), lastState: null, tvLeftAt: Date.now(), createdAt: Date.now() };
      rooms.set(id, room);
    }
    return room;
  }

  /** Token bucket: 40 messages burst, 20/s sustained. Volume-button mashing is ~10/s. */
  function allow(/** @type {Client} */ client) {
    const now = Date.now();
    client.tokens = Math.min(40, client.tokens + ((now - client.lastRefill) / 1000) * 20);
    client.lastRefill = now;
    if (client.tokens < 1) {
      if (now - client.warnedAt > 2000) {
        client.warnedAt = now;
        send(client, { t: 'error', code: 'rate-limited', message: 'Slow down.' });
      }
      return false;
    }
    client.tokens -= 1;
    return true;
  }

  /** @param {Client} client @param {any} msg */
  function handleJoin(client, msg) {
    if (client.role) return send(client, { t: 'error', code: 'bad-request', message: 'Already joined.' });
    if (msg.v !== PROTOCOL_VERSION) {
      return send(client, { t: 'error', code: 'version', message: 'Please reload the page.' });
    }
    if ((msg.role !== 'tv' && msg.role !== 'remote') || !SESSION_RE.test(msg.session) || !CLIENT_ID_RE.test(msg.clientId)) {
      return send(client, { t: 'error', code: 'bad-request', message: 'Invalid join.' });
    }
    const room = getRoom(msg.session);
    const label = typeof msg.label === 'string' ? msg.label.slice(0, 48) : '';

    if (msg.role === 'tv') {
      if (room.tv && room.tv.ws.readyState === WebSocket.OPEN) {
        if (room.tv.clientId !== msg.clientId) {
          return send(client, { t: 'error', code: 'session-in-use', message: 'Another screen owns this code.' });
        }
        // Same TV reconnecting before we noticed the old socket died: newest wins.
        const old = room.tv;
        room.tv = null;
        send(old, { t: 'replaced' });
        old.session = null;
        old.ws.close(4001, 'replaced');
      }
      room.tv = client;
      room.tvLeftAt = 0;
    } else {
      const existing = room.remotes.get(msg.clientId);
      if (existing) {
        room.remotes.delete(msg.clientId);
        send(existing, { t: 'replaced' });
        existing.session = null;
        existing.ws.close(4001, 'replaced');
      } else if (room.remotes.size >= maxRemotes) {
        return send(client, { t: 'error', code: 'room-full', message: 'Too many remotes on this TV.' });
      }
      room.remotes.set(msg.clientId, client);
    }

    client.role = msg.role;
    client.session = msg.session;
    client.clientId = msg.clientId;
    client.label = label;

    send(client, { t: 'welcome', session: room.id, role: client.role, clientId: client.clientId, presence: presenceOf(room) });
    if (client.role === 'remote' && room.lastState && room.tv) send(client, { t: 'state', state: room.lastState });
    broadcastPresence(room);
  }

  /** @param {Client} client */
  function leave(client) {
    if (!client.session) return;
    const room = rooms.get(client.session);
    client.session = null;
    if (!room) return;
    if (client.role === 'tv' && room.tv === client) {
      room.tv = null;
      room.tvLeftAt = Date.now();
    } else if (client.role === 'remote' && client.clientId && room.remotes.get(client.clientId) === client) {
      room.remotes.delete(client.clientId);
    } else {
      return;
    }
    broadcastPresence(room);
  }

  /** @param {Client} client @param {any} msg */
  function handleMessage(client, msg) {
    if (!msg || typeof msg.t !== 'string') return;
    if (msg.t === 'ping') return send(client, { t: 'pong', ts: typeof msg.ts === 'number' ? msg.ts : 0 });
    if (!allow(client)) return;
    if (msg.t === 'join') return handleJoin(client, msg);

    const room = client.session ? rooms.get(client.session) : undefined;
    if (!room || !client.role) return send(client, { t: 'error', code: 'not-joined', message: 'Join first.' });

    switch (msg.t) {
      case 'cmd': {
        if (client.role !== 'remote' || typeof msg.cid !== 'number' || !msg.cmd || typeof msg.cmd.type !== 'string') return;
        if (!room.tv) return send(client, { t: 'nack', cid: msg.cid, reason: 'tv-offline' });
        send(room.tv, { t: 'cmd', from: client.clientId, cid: msg.cid, cmd: msg.cmd });
        return;
      }
      case 'state': {
        if (client.role !== 'tv' || room.tv !== client || !msg.state || typeof msg.state !== 'object') return;
        room.lastState = msg.state;
        const out = JSON.stringify({ t: 'state', state: msg.state });
        for (const remote of room.remotes.values()) if (remote.ws.readyState === WebSocket.OPEN) remote.ws.send(out);
        return;
      }
      case 'leave':
        leave(client);
        client.ws.close(1000, 'left');
        return;
      case 'end': {
        if (client.role !== 'tv' || room.tv !== client) return;
        for (const remote of room.remotes.values()) {
          send(remote, { t: 'ended', reason: 'tv-ended' });
          remote.session = null;
        }
        room.remotes.clear();
        room.tv = null;
        rooms.delete(room.id);
        client.session = null;
        client.ws.close(1000, 'ended');
        return;
      }
    }
  }

  wss.on('connection', (ws, req) => {
    const ip = ipOf(req);
    /** @type {Client} */
    const client = {
      ws, ip, role: null, session: null, clientId: null, label: '',
      tokens: 40, lastRefill: Date.now(), alive: true, warnedAt: 0,
    };
    perIp.set(ip, (perIp.get(ip) || 0) + 1);
    clientOf.set(ws, client);

    ws.on('pong', () => (client.alive = true));
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      handleMessage(client, msg);
    });
    ws.on('close', () => {
      leave(client);
      const n = (perIp.get(ip) || 1) - 1;
      if (n <= 0) perIp.delete(ip);
      else perIp.set(ip, n);
    });
    ws.on('error', () => {});
  });

  // Protocol-level heartbeat: drop sockets that stopped answering (phones that went to sleep).
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      const client = clientOf.get(ws);
      if (client && !client.alive) {
        ws.terminate();
        continue;
      }
      if (client) client.alive = false;
      try {
        ws.ping();
      } catch {
        /* ignore */
      }
    }
  }, 20_000);

  // Room garbage collection.
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      const tvGoneTooLong = !room.tv && room.tvLeftAt && now - room.tvLeftAt > roomTtlMs;
      if (tvGoneTooLong) {
        for (const remote of room.remotes.values()) {
          send(remote, { t: 'ended', reason: 'tv-ended' });
          remote.session = null;
        }
        rooms.delete(room.id);
      }
    }
  }, 60_000);
  heartbeat.unref?.();
  sweeper.unref?.();

  return {
    /**
     * @param {import('node:http').IncomingMessage} req
     * @param {import('node:stream').Duplex} socket
     * @param {Buffer} head
     */
    handleUpgrade(req, socket, head) {
      const origin = req.headers.origin;
      if (allowedOrigins.length && origin && !allowedOrigins.includes(origin)) {
        log.warn(`[relay] rejected origin ${origin}`);
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      const ip = ipOf(req);
      if ((perIp.get(ip) || 0) >= maxConnectionsPerIp) {
        socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    },
    stats() {
      let remotes = 0;
      let tvs = 0;
      for (const room of rooms.values()) {
        remotes += room.remotes.size;
        if (room.tv) tvs += 1;
      }
      return { rooms: rooms.size, tvs, remotes, sockets: wss.clients.size };
    },
    close() {
      clearInterval(heartbeat);
      clearInterval(sweeper);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
  };
}
