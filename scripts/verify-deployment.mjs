#!/usr/bin/env node
/**
 * Smoke-test a live deployment the way a visitor would use it:
 *
 *   1. /healthz answers (waits for a sleeping free-tier instance to wake up)
 *   2. the TV page loads and its pairing link reaches the relay over WebSocket
 *   3. the QR code is read from the screen pixels and must point at the PUBLIC /remote URL
 *      (not localhost, not a LAN address) for this TV's session
 *   4. a phone (separate browser process, iPhone emulation) opens that URL, pairs, and its
 *      CH ▲ / MUTE presses change the TV
 *
 * Usage:
 *   npm run verify:deploy -- https://channel-surf-tv.onrender.com
 *   node scripts/verify-deployment.mjs <url> [--expect-origin <origin>] [--timeout <seconds>] [--out <dir>]
 *
 * Screenshots (TV, decoded QR, remote) are written to ./verify-output/ by default.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium, devices } from '@playwright/test';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const target = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!target) {
  console.error('usage: node scripts/verify-deployment.mjs <url> [--expect-origin <origin>] [--timeout <s>] [--out <dir>]');
  process.exit(2);
}
const base = new URL(target);
const expectOrigin = new URL(opt('--expect-origin') ?? base.origin).origin;
const timeoutMs = Number(opt('--timeout') ?? 150) * 1000;
const outDir = path.resolve(opt('--out') ?? 'verify-output');
fs.mkdirSync(outDir, { recursive: true });

const results = [];
const pass = (msg) => (results.push(['PASS', msg]), console.log(`  ✓ ${msg}`));
const fail = (msg) => {
  results.push(['FAIL', msg]);
  console.log(`  ✗ ${msg}`);
  throw new Error(msg);
};
const check = (ok, msg, detail = '') => (ok ? pass(msg) : fail(`${msg}${detail ? ` — ${detail}` : ''}`));

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[::1\]|169\.254\.)/;
const expectPrivate = PRIVATE_HOST.test(new URL(expectOrigin).hostname);

async function waitForHealth() {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(new URL('/healthz', base), { cache: 'no-store' });
      if (res.ok) return res.json();
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = err.cause?.code || err.message;
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error(`no healthy response from ${base.origin}/healthz within ${timeoutMs / 1000}s (${last})`);
}

let tvBrowser;
let phoneBrowser;
try {
  console.log(`\nVerifying ${base.origin}  (QR codes must point at ${expectOrigin})\n`);

  const health = await waitForHealth().catch((e) => fail(e.message));
  check(health?.ok === true, 'server is up (/healthz)', JSON.stringify(health));

  const network = await (await fetch(new URL('/api/network', base), { cache: 'no-store' })).json();
  check(
    network.publicUrl === expectOrigin,
    `server reports public URL ${network.publicUrl}`,
    `expected ${expectOrigin}; set PUBLIC_URL on the host`,
  );

  // ----- the TV -------------------------------------------------------------------------------
  tvBrowser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const tv = await tvBrowser.newPage({ viewport: { width: 1440, height: 900 } });
  tv.on('pageerror', (e) => console.log(`    [tv pageerror] ${e.message}`));
  await tv.goto(base.href, { waitUntil: 'load', timeout: timeoutMs });
  await tv.waitForFunction(() => document.documentElement.dataset.link === 'online', null, { timeout: 30_000 }).catch(() =>
    fail('TV could not reach the pairing relay (WebSocket /rc)'),
  );
  pass('TV page loaded and connected to the relay over WebSocket');
  await tv
    .waitForFunction(
      () => {
        const v = document.querySelector(`video[data-channel="${document.documentElement.dataset.channel}"]`);
        return v && !v.paused && v.currentTime > 0.2;
      },
      null,
      { timeout: 30_000 },
    )
    .then(
      () => pass('TV is playing channel 01'),
      () => console.log('    (video playback not confirmed — headless Chromium lacks H.264; WebM fallback may still be buffering)'),
    );

  const session = await tv.locator('.pair').getAttribute('data-session');
  const advertised = await tv.locator('.pair').getAttribute('data-pair-url');
  await tv.screenshot({ path: path.join(outDir, 'tv.png') });

  // Read the QR code off the screen like a phone camera.
  await tv.keyboard.press('r');
  const qrEl = tv.locator('.pair__qr--big');
  await qrEl.waitFor({ state: 'visible' });
  const qrPng = await qrEl.screenshot({ path: path.join(outDir, 'qr.png') });
  const img = PNG.sync.read(qrPng);
  const decoded = jsQR(new Uint8ClampedArray(img.data), img.width, img.height)?.data;
  check(!!decoded, 'QR code decoded from the screen pixels');
  console.log(`    QR → ${decoded}`);
  const qr = new URL(decoded);
  check(decoded === advertised, 'QR content matches the link shown on the TV');
  check(qr.origin === expectOrigin, `QR points at the public origin ${expectOrigin}`, `got ${qr.origin}`);
  check(qr.pathname === '/remote', 'QR opens /remote', `got ${qr.pathname}`);
  check(qr.searchParams.get('session') === session && /^[A-HJ-NP-Z2-9]{6}$/.test(session), `QR carries this TV's session (${session})`);
  if (!expectPrivate) {
    check(!PRIVATE_HOST.test(qr.hostname), 'QR is not a localhost / LAN address', qr.hostname);
    if (base.protocol === 'https:') check(qr.protocol === 'https:', 'QR uses https');
  }
  await tv.keyboard.press('Escape');

  // ----- the phone (separate browser process) ---------------------------------------------------
  phoneBrowser = await chromium.launch();
  const { defaultBrowserType: _ignored, ...iPhone } = devices['iPhone 13'];
  const phone = await (await phoneBrowser.newContext(iPhone)).newPage();
  phone.on('pageerror', (e) => console.log(`    [phone pageerror] ${e.message}`));
  await phone.goto(decoded, { waitUntil: 'load', timeout: timeoutMs });
  await phone.waitForFunction(() => document.documentElement.dataset.status === 'ready', null, { timeout: 30_000 }).catch(async () =>
    fail(`phone did not pair (status: ${await phone.evaluate(() => document.documentElement.dataset.status)})`),
  );
  pass('phone opened the QR link and paired with this TV');
  await tv.waitForFunction(() => document.documentElement.dataset.remotes === '1', null, { timeout: 15_000 });
  pass('TV shows the remote as connected');

  await phone.locator('[aria-label="Channel up"]').tap();
  await tv
    .waitForFunction(() => document.documentElement.dataset.channel === '2', null, { timeout: 15_000 })
    .catch(() => fail('CH ▲ on the phone did not change the TV channel'));
  pass('phone CH ▲ → TV switched to channel 02');
  await phone
    .waitForFunction(() => document.querySelector('.vfd__ch-num')?.textContent === '02', null, { timeout: 15_000 })
    .catch(() => fail('phone display did not follow the TV'));
  pass('phone display shows CH 02 (state synced back)');

  const mutedBefore = await tv.evaluate(() => document.documentElement.dataset.muted);
  await phone.locator('[aria-label="Mute"]').tap();
  await tv
    .waitForFunction((m) => document.documentElement.dataset.muted !== m, mutedBefore, { timeout: 15_000 })
    .catch(() => fail('MUTE on the phone did not change the TV'));
  pass('phone MUTE toggled the TV sound');

  await phone.waitForTimeout(400);
  await phone.screenshot({ path: path.join(outDir, 'remote.png') });
  await tv.screenshot({ path: path.join(outDir, 'tv-paired.png') });
  console.log(`\nAll checks passed. Screenshots in ${path.relative(process.cwd(), outDir) || '.'}/\n`);
} catch (err) {
  if (!results.some(([s]) => s === 'FAIL')) console.log(`  ✗ ${err.message}`);
  console.log('\nVerification FAILED.\n');
  process.exitCode = 1;
} finally {
  await tvBrowser?.close();
  await phoneBrowser?.close();
}
