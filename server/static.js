// @ts-check
import fs from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/**
 * Tiny static file handler with HTTP Range support (Safari will not play <video> without it),
 * ETags, and long-lived caching for Vite's hashed assets.
 *
 * @param {string} root absolute directory to serve
 */
export function createStaticHandler(root) {
  const rootResolved = path.resolve(root);

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {string} pathname already-decoded URL path
   * @returns {boolean} whether the request was handled
   */
  return function serve(req, res, pathname) {
    let rel = pathname;
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(rootResolved, '.' + rel);
    if (!file.startsWith(rootResolved + path.sep)) return false;

    let stat;
    try {
      stat = fs.statSync(file);
      if (stat.isDirectory()) return serve(req, res, pathname.replace(/\/?$/, '/'));
    } catch {
      return false;
    }

    const ext = path.extname(file).toLowerCase();
    const type = /** @type {Record<string, string>} */ (MIME)[ext] || 'application/octet-stream';
    const etag = `W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
    const hashed = /\/assets\//.test(pathname);

    res.setHeader('Content-Type', type);
    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', stat.mtime.toUTCString());
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (hashed) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    else if (ext === '.html') res.setHeader('Cache-Control', 'no-cache');
    else res.setHeader('Cache-Control', 'public, max-age=3600');
    // Lets the WebGL renderer sample videos even if media is later moved to a CDN/subdomain.
    if (ext === '.mp4' || ext === '.webm' || ext === '.jpg') res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.headers['if-none-match'] === etag) {
      res.statusCode = 304;
      res.end();
      return true;
    }

    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      let start = match && match[1] ? parseInt(match[1], 10) : NaN;
      let end = match && match[2] ? parseInt(match[2], 10) : NaN;
      if (match && Number.isNaN(start) && !Number.isNaN(end)) {
        start = Math.max(0, stat.size - end); // suffix range: last N bytes
        end = stat.size - 1;
      } else {
        if (Number.isNaN(end) || end >= stat.size) end = stat.size - 1;
      }
      if (!match || Number.isNaN(start) || start > end || start >= stat.size) {
        res.statusCode = 416;
        res.setHeader('Content-Range', `bytes */${stat.size}`);
        res.end();
        return true;
      }
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      res.setHeader('Content-Length', String(end - start + 1));
      if (req.method === 'HEAD') return void res.end(), true;
      fs.createReadStream(file, { start, end }).pipe(res);
      return true;
    }

    res.statusCode = 200;
    res.setHeader('Content-Length', String(stat.size));
    if (req.method === 'HEAD') return void res.end(), true;
    fs.createReadStream(file).pipe(res);
    return true;
  };
}
