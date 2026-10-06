#!/usr/bin/env node
// Stand-in for `cloudflared tunnel --url …` in tests: prints the same log lines a real Quick
// Tunnel prints (format captured from cloudflared 2026.10.0), then stays up until killed.
//   FAKE_TUNNEL_URL   URL to announce (default https://quiet-test-signal.trycloudflare.com)
//   FAKE_TUNNEL_FAIL  if set, fail like a blocked network does
const ts = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const log = (msg) => process.stderr.write(`${ts()} ${msg}\n`);
const url = process.env.FAKE_TUNNEL_URL || 'https://quiet-test-signal.trycloudflare.com';

if (process.argv.includes('--version')) {
  process.stdout.write('cloudflared version 2026.10.0 (fake)\n');
  process.exit(0);
}

log('INF Thank you for trying Cloudflare Tunnel. Doing so, without a Cloudflare account, is a quick way to experiment and try it out.');
log('INF Requesting new quick Tunnel on trycloudflare.com...');
if (process.env.FAKE_TUNNEL_FAIL) {
  process.stderr.write('quick tunnel provisioning failed with status 403\n');
  process.exit(1);
}
setTimeout(() => {
  log('INF +--------------------------------------------------------------------------------------------+');
  log('INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |');
  log(`INF |  ${url.padEnd(90)}|`);
  log('INF +--------------------------------------------------------------------------------------------+');
  log(`INF Starting tunnel tunnelID=00000000-0000-0000-0000-000000000000`);
  setTimeout(() => log('INF Registered tunnel connection connIndex=0 connection=fake event=0 ip=198.41.192.7 location=test protocol=quic'), 200);
}, 300);
setInterval(() => {}, 1 << 30);
process.on('SIGTERM', () => process.exit(0));
