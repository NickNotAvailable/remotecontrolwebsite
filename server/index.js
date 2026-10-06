// @ts-check
/**
 * Production server: serves the built site (dist/) and hosts the pairing relay on /rc.
 *
 *   npm run build && npm start
 *
 * Environment:
 *   PORT              default 3000
 *   HOST              default 0.0.0.0 (reachable from phones on the same network)
 *   PUBLIC_URL        canonical base URL to put in QR codes, e.g. https://avery.tv
 *                     (defaults to the platform's own: RENDER_EXTERNAL_URL, RAILWAY_PUBLIC_DOMAIN…)
 *   ALLOWED_ORIGINS   comma-separated list of origins allowed to open the relay socket
 *   TRUST_PROXY       set to 1 behind a reverse proxy so per-IP limits use X-Forwarded-For
 *
 * Testing from a phone on another network? `npm run tunnel` (scripts/tunnel.mjs).
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { networkInfo } from './network.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '..', 'dist');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('dist/ is missing — run `npm run build` first (or use `npm run dev` while developing).');
  process.exit(1);
}

const app = createApp({
  dist,
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  trustProxy: process.env.TRUST_PROXY === '1',
});

app.listen(PORT, HOST).then(
  (port) => {
    console.log(`\n  📺  TV        http://localhost:${port}/`);
    if (app.publicUrl) {
      console.log(`      public    ${app.publicUrl}/   (QR codes point here)`);
    } else {
      for (const lan of networkInfo({ port, publicUrl: '' }).lanUrls) console.log(`      on LAN    ${lan}/`);
    }
    console.log(`  📱  Remote    /remote?session=<CODE>  (scan the QR code on the TV)\n`);
  },
  (err) => {
    console.error(`Could not listen on ${HOST}:${PORT} — ${err.message}`);
    process.exit(1);
  },
);

function shutdown() {
  void app.close().then(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
