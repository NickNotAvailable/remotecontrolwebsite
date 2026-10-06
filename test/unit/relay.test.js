// Unit tests for the pairing relay, using real sockets on an ephemeral port.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import { createRelay } from '../../server/relay.js';

let server;
let relay;
let url;

before(async () => {
  relay = createRelay({ maxRemotes: 2, log: { info() {}, warn() {} } });
  server = http.createServer();
  server.on('upgrade', (req, socket, head) => relay.handleUpgrade(req, socket, head));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `ws://127.0.0.1:${server.address().port}/rc`;
});

after(() => {
  relay.close();
  server.close();
});

/** Opens a socket and returns helpers to send and await messages. */
async function client() {
  const ws = new WebSocket(url);
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => {
    const msg = JSON.parse(d.toString());
    const i = waiters.findIndex((w) => w.match(msg));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
    else inbox.push(msg);
  });
  await new Promise((r, j) => (ws.once('open', r), ws.once('error', j)));
  return {
    ws,
    send: (m) => ws.send(JSON.stringify(m)),
    next(match = () => true, timeout = 2000) {
      const i = inbox.findIndex(match);
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const w = { match, resolve };
        waiters.push(w);
        setTimeout(() => reject(new Error('timeout waiting for message')), timeout).unref();
      });
    },
    close: () => ws.close(),
  };
}

const join = (role, session, clientId) => ({ t: 'join', v: 1, role, session, clientId, label: 'test' });
const is = (t) => (m) => m.t === t;

test('remote commands reach the TV and TV state reaches the remote', async () => {
  const tv = await client();
  tv.send(join('tv', 'ABCDEF', 'tv-client-1'));
  const welcome = await tv.next(is('welcome'));
  assert.equal(welcome.presence.tv, true);

  const remote = await client();
  remote.send(join('remote', 'ABCDEF', 'remote-client-1'));
  const rw = await remote.next(is('welcome'));
  assert.equal(rw.presence.tv, true);

  const presence = await tv.next((m) => m.t === 'presence' && m.presence.remotes.length === 1);
  assert.equal(presence.presence.remotes[0].id, 'remote-client-1');

  remote.send({ t: 'cmd', cid: 1, cmd: { type: 'channel-step', delta: 1 } });
  const cmd = await tv.next(is('cmd'));
  assert.deepEqual(cmd, { t: 'cmd', from: 'remote-client-1', cid: 1, cmd: { type: 'channel-step', delta: 1 } });

  tv.send({ t: 'state', state: { channel: 2 } });
  const st = await remote.next(is('state'));
  assert.equal(st.state.channel, 2);

  // A late joiner gets the cached snapshot right away.
  const late = await client();
  late.send(join('remote', 'ABCDEF', 'remote-client-2'));
  const cached = await late.next(is('state'));
  assert.equal(cached.state.channel, 2);

  tv.close();
  remote.close();
  late.close();
});

test('a second TV cannot steal a live session', async () => {
  const a = await client();
  a.send(join('tv', 'GHJKMN', 'tv-a-000001'));
  await a.next(is('welcome'));
  const b = await client();
  b.send(join('tv', 'GHJKMN', 'tv-b-000001'));
  const err = await b.next(is('error'));
  assert.equal(err.code, 'session-in-use');
  a.close();
  b.close();
});

test('same TV reconnecting replaces its stale socket', async () => {
  const a = await client();
  a.send(join('tv', 'PQRSTU', 'tv-same-0001'));
  await a.next(is('welcome'));
  const b = await client();
  b.send(join('tv', 'PQRSTU', 'tv-same-0001'));
  await b.next(is('welcome'));
  const replaced = await a.next(is('replaced'));
  assert.equal(replaced.t, 'replaced');
  b.close();
});

test('remote waits for a TV that is not there yet, and sees it arrive', async () => {
  const remote = await client();
  remote.send(join('remote', 'VWXYZ2', 'remote-wait-1'));
  const w = await remote.next(is('welcome'));
  assert.equal(w.presence.tv, false);
  remote.send({ t: 'cmd', cid: 7, cmd: { type: 'mute-toggle' } });
  const nack = await remote.next(is('nack'));
  assert.equal(nack.cid, 7);

  const tv = await client();
  tv.send(join('tv', 'VWXYZ2', 'tv-late-0001'));
  const p = await remote.next((m) => m.t === 'presence' && m.presence.tv === true);
  assert.equal(p.presence.tv, true);

  tv.close();
  const gone = await remote.next((m) => m.t === 'presence' && m.presence.tv === false);
  assert.equal(gone.presence.tv, false);
  remote.close();
});

test('ending a session notifies remotes; room limit is enforced; bad joins rejected', async () => {
  const tv = await client();
  tv.send(join('tv', '234567', 'tv-end-00001'));
  await tv.next(is('welcome'));
  const r1 = await client();
  r1.send(join('remote', '234567', 'remote-end-1'));
  await r1.next(is('welcome'));
  const r2 = await client();
  r2.send(join('remote', '234567', 'remote-end-2'));
  await r2.next(is('welcome'));
  const r3 = await client();
  r3.send(join('remote', '234567', 'remote-end-3'));
  assert.equal((await r3.next(is('error'))).code, 'room-full');

  tv.send({ t: 'end' });
  assert.equal((await r1.next(is('ended'))).reason, 'tv-ended');
  assert.equal((await r2.next(is('ended'))).reason, 'tv-ended');

  const bad = await client();
  bad.send(join('remote', 'abc', 'x'));
  assert.equal((await bad.next(is('error'))).code, 'bad-request');
  const old = await client();
  old.send({ ...join('remote', '234567', 'remote-old-1'), v: 99 });
  assert.equal((await old.next(is('error'))).code, 'version');
  for (const c of [r1, r2, r3, bad, old]) c.close();
});

test('ping is answered without joining', async () => {
  const c = await client();
  c.send({ t: 'ping', ts: 42 });
  assert.equal((await c.next(is('pong'))).ts, 42);
  c.close();
});
