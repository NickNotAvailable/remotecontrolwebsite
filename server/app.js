// @ts-check
/**
 * The HTTP server: built site (dist/) + pairing relay (WebSocket /rc) + two small JSON routes.
 * Used by `npm start` (server/index.js) and `npm run tunnel` (scripts/tunnel.mjs).
 */
import http from 'node:http';
import { createRelay } from './relay.js';
import { createStaticHandler } from './static.js';
import { detectPublicUrl, networkInfo } from './network.js';

/**
 * @param {{
 *   dist: string,
 *   publicUrl?: string,
 *   allowedOrigins?: string[],
 *   trustProxy?: boolean,
 * }} options
 */
export function createApp({ dist, publicUrl = detectPublicUrl(), allowedOrigins = [], trustProxy = false }) {
  /** Base URL for QR codes; can change at runtime (a tunnel's URL is only known after start). */
  let currentPublicUrl = clean(publicUrl);
  const relay = createRelay({ allowedOrigins, trustProxy });
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
      res.setHeader('Cache-Control', 'no-store');
      return res.end(JSON.stringify({ ok: true, ...relay.stats() }));
    }
    if (pathname === '/api/network') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      // With a public URL, LAN addresses are useless to visitors (and not theirs to know).
      if (currentPublicUrl) return res.end(JSON.stringify({ publicUrl: currentPublicUrl, lanUrls: [] }));
      const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0];
      return res.end(JSON.stringify(networkInfo({ port: listeningPort(), protocol: proto, publicUrl: '' })));
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

  function listeningPort() {
    const addr = server.address();
    return typeof addr === 'object' && addr ? addr.port : 0;
  }

  return {
    server,
    relay,
    get port() {
      return listeningPort();
    },
    get publicUrl() {
      return currentPublicUrl;
    },
    /** @param {string} url */
    setPublicUrl(url) {
      currentPublicUrl = clean(url);
    },
    /**
     * @param {number} port
     * @param {string} host
     * @returns {Promise<number>} the port actually bound
     */
    listen(port, host) {
      return new Promise((resolve, reject) => {
        const onError = (/** @type {Error} */ err) => {
          server.off('listening', onListening);
          reject(err);
        };
        const onListening = () => {
          server.off('error', onError);
          resolve(listeningPort());
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
      });
    },
    close() {
      relay.close();
      return new Promise((resolve) => server.close(() => resolve(undefined)));
    },
  };
}

/** @param {string | undefined | null} url */
function clean(url) {
  return (url || '').trim().replace(/\/+$/, '');
}
