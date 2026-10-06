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
 */
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRelay } from './relay.js';
import { createStaticHandler } from './static.js';
import { detectPublicUrl, networkInfo } from './network.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '..', 'dist');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('dist/ is missing — run `npm run build` first (or use `npm run dev` while developing).');
  process.exit(1);
}

const relay = createRelay({
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  trustProxy: process.env.TRUST_PROXY === '1',
});
const serveStatic = createStaticHandler(dist);

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.statusCode = 400;
    return res.end('Bad request');
  }

  if (pathname === '/healthz') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: true, ...relay.stats() }));
  }
  if (pathname === '/api/network') {
    const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0];
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(JSON.stringify(networkInfo({ port: PORT, protocol: proto })));
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    return res.end();
  }
  // Clean URL for the phone remote: /remote?session=ABC123
  if (pathname === '/remote') pathname = '/remote/';

  if (serveStatic(req, res, pathname)) return;
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('Not found');
});

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url || '/', 'http://localhost');
  if (pathname === '/rc') relay.handleUpgrade(req, socket, head);
  else socket.destroy();
});

server.listen(PORT, HOST, () => {
  const publicUrl = detectPublicUrl();
  console.log(`\n  📺  TV        http://localhost:${PORT}/`);
  if (publicUrl) {
    console.log(`      public    ${publicUrl}/   (QR codes point here)`);
  } else {
    for (const lan of networkInfo({ port: PORT }).lanUrls) console.log(`      on LAN    ${lan}/`);
  }
  console.log(`  📱  Remote    /remote?session=<CODE>  (scan the QR code on the TV)\n`);
});

function shutdown() {
  relay.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
