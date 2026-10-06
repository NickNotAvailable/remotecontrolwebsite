#!/usr/bin/env node
/**
 * Put the whole app on the public internet in one command, for testing with a phone on any
 * network (cellular included):
 *
 *   npm run tunnel
 *
 * 1. builds the site (vite build)
 * 2. starts the production server (site + WebSocket relay) on 127.0.0.1
 * 3. opens a free Cloudflare Quick Tunnel to it → https://<random>.trycloudflare.com
 *    (no Cloudflare account; WebSockets pass straight through)
 * 4. tells the server that URL, so the TV's QR code points at the tunnel — never at localhost
 *    or a LAN address
 * 5. opens the public URL in your desktop browser
 *
 * cloudflared comes from PATH or $CLOUDFLARED_BIN; otherwise the official binary is downloaded
 * once from github.com/cloudflare/cloudflared into node_modules/.cache/cloudflared.
 *
 * Options:  --port <n> (default 3000)   --no-open   --no-build   --verbose
 * Stop with Ctrl+C. The URL changes every run.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';
import { resolveCloudflared, startQuickTunnel } from './lib/cloudflared.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const opts = {
  port: Number(value('--port', process.env.PORT || 3000)),
  open: !flag('--no-open'),
  build: !flag('--no-build'),
  verbose: flag('--verbose'),
};

const c = process.stdout.isTTY
  ? { b: (s) => `\x1b[1m${s}\x1b[22m`, dim: (s) => `\x1b[2m${s}\x1b[22m`, green: (s) => `\x1b[32m${s}\x1b[39m`, red: (s) => `\x1b[31m${s}\x1b[39m`, cyan: (s) => `\x1b[36m${s}\x1b[39m` }
  : { b: String, dim: String, green: String, red: String, cyan: String };
const step = (msg) => console.log(`${c.cyan('›')} ${msg}`);
const die = (msg, extra = '') => {
  console.error(`\n${c.red('✗')} ${msg}${extra ? `\n\n${c.dim(extra)}` : ''}\n`);
  process.exit(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ----- 1. build ---------------------------------------------------------------------------------
const dist = path.join(root, 'dist');
if (opts.build || !fs.existsSync(path.join(dist, 'index.html'))) {
  step('Building the site…');
  const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!fs.existsSync(vite)) die('Dependencies are missing. Run `npm install` first.');
  const r = spawnSync(process.execPath, [vite, 'build', '--logLevel', 'warn'], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) die('Build failed (see above).');
}

// ----- 2. local server --------------------------------------------------------------------------
// Bound to 127.0.0.1: only the tunnel (running on this machine) needs to reach it.
// trustProxy: per-IP limits use the visitor's IP that Cloudflare forwards, not 127.0.0.1.
const app = createApp({ dist, publicUrl: '', trustProxy: true });
let port = opts.port;
for (let attempt = 0; ; attempt++) {
  try {
    port = await app.listen(port, '127.0.0.1');
    break;
  } catch (err) {
    if (err.code !== 'EADDRINUSE' || attempt >= 10) die(`Could not start the local server on port ${port}: ${err.message}`);
    port += 1;
  }
}
const localUrl = `http://127.0.0.1:${port}`;
step(`Local server on ${localUrl}`);

// ----- 3. tunnel ---------------------------------------------------------------------------------
let bin;
try {
  bin = await resolveCloudflared({ cacheDir: path.join(root, 'node_modules', '.cache', 'cloudflared'), log: step });
} catch (err) {
  die(
    `Could not get cloudflared: ${err.message}`,
    'Install it, then run `npm run tunnel` again:\n' +
      '  macOS:   brew install cloudflared\n' +
      '  Windows: winget install --id Cloudflare.cloudflared\n' +
      '  Linux:   https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/',
  );
}

step('Opening a Cloudflare Quick Tunnel…');
const tunnel = startQuickTunnel({
  bin,
  localUrl,
  onLine: (line) => {
    if (opts.verbose || /\b(ERR|error|failed)\b/i.test(line)) console.log(c.dim(`  cloudflared │ ${line}`));
  },
});

let shuttingDown = false;
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  tunnel.stop();
  await Promise.race([app.close(), sleep(1500)]);
  process.exit(code);
}
process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

const exitedEarly = tunnel.exited.then((e) => {
  if (shuttingDown) return;
  die(
    `cloudflared stopped (exit code ${e.code}).`,
    `${e.tail}\n\nTips: check your internet connection; a ~/.cloudflared/config.yml with a named tunnel can ` +
      'interfere with Quick Tunnels (rename it temporarily); some networks block outbound port 7844.',
  );
});

const urlTimeout = setTimeout(() => {
  tunnel.stop();
  die('Timed out waiting for Cloudflare to assign a tunnel URL.');
}, 90_000);
const publicUrl = await tunnel.url;
clearTimeout(urlTimeout);
// Every QR code generated from now on points here.
app.setPublicUrl(publicUrl);

// ----- 4. wait until the public URL actually answers ----------------------------------------------
if (!process.env.TUNNEL_SKIP_PROBE) {
  step(`Tunnel assigned ${c.b(publicUrl)} — waiting for it to come online…`);
  await Promise.race([tunnel.ready, sleep(30_000)]);
  let reachable = false;
  for (let i = 0; i < 30 && !reachable; i++) {
    try {
      const res = await fetch(`${publicUrl}/healthz`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      reachable = res.ok;
    } catch {
      /* DNS / edge still warming up */
    }
    if (!reachable) await sleep(2000);
  }
  if (!reachable) console.log(c.dim('  (not reachable from this machine yet — it usually is within a minute; carrying on)'));
}

// ----- 5. ready ------------------------------------------------------------------------------------
console.log(`
${c.green('●')} ${c.b('Live on the public internet')}

   Desktop   ${c.b(publicUrl)}
   Phone     scan the QR code on the TV — works on cellular, no shared Wi-Fi needed
   Stop      Ctrl+C ${c.dim('(the URL changes every run)')}
`);

if (opts.open) {
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [publicUrl]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', publicUrl]]
        : ['xdg-open', [publicUrl]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    /* no browser to open — the URL is printed above */
  }
}

await exitedEarly;
