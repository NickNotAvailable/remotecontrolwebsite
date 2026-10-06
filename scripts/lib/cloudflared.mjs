/**
 * Minimal helpers around Cloudflare's `cloudflared` binary for account-less Quick Tunnels
 * (https://<random>.trycloudflare.com). No npm dependency: the official binary is used from PATH,
 * from $CLOUDFLARED_BIN, or downloaded from GitHub releases on first use into a local cache.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const RELEASES = 'https://github.com/cloudflare/cloudflared/releases/latest/download';

/** Which release asset fits this machine. */
export function releaseAsset(platform = process.platform, arch = process.arch) {
  const cpu = { x64: 'amd64', arm64: 'arm64', arm: 'arm', ia32: '386' }[arch];
  if (platform === 'linux' && cpu) return { name: `cloudflared-linux-${cpu}`, tgz: false, exe: 'cloudflared' };
  if (platform === 'darwin' && (cpu === 'amd64' || cpu === 'arm64')) {
    return { name: `cloudflared-darwin-${cpu}.tgz`, tgz: true, exe: 'cloudflared' };
  }
  if (platform === 'win32') {
    // arm64 Windows runs the amd64 build under emulation
    return { name: `cloudflared-windows-${cpu === '386' ? '386' : 'amd64'}.exe`, tgz: false, exe: 'cloudflared.exe' };
  }
  return null;
}

/** The public URL in cloudflared's log output, e.g. https://calm-river-sunset.trycloudflare.com */
export function findTunnelUrl(text) {
  const m = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com\b/i.exec(text);
  return m ? m[0].toLowerCase() : null;
}

function works(bin) {
  try {
    const r = spawnSync(bin, ['--version'], { stdio: 'ignore', timeout: 15_000, windowsHide: true });
    return r.status === 0;
  } catch {
    return false;
  }
}

/**
 * Locate cloudflared: $CLOUDFLARED_BIN → PATH → cache → download.
 * @param {{ cacheDir: string, log?: (msg: string) => void }} opts
 * @returns {Promise<string>} path (or command name) to run
 */
export async function resolveCloudflared({ cacheDir, log = () => {} }) {
  if (process.env.CLOUDFLARED_BIN) return process.env.CLOUDFLARED_BIN;
  if (works('cloudflared')) return 'cloudflared';

  const asset = releaseAsset();
  if (!asset) {
    throw new Error(
      `No cloudflared download for ${process.platform}/${process.arch}. Install it yourself: ` +
        'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/',
    );
  }
  const bin = path.join(cacheDir, asset.exe);
  if (fs.existsSync(bin) && works(bin)) return bin;

  fs.mkdirSync(cacheDir, { recursive: true });
  const url = `${RELEASES}/${asset.name}`;
  log(`Downloading cloudflared (one time, ~40 MB) from ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status} for ${url}`);
  const tmp = path.join(cacheDir, `${asset.name}.download`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));

  if (asset.tgz) {
    const r = spawnSync('tar', ['-xzf', tmp, '-C', cacheDir], { stdio: 'inherit' });
    fs.rmSync(tmp, { force: true });
    if (r.status !== 0) throw new Error('Could not unpack the cloudflared archive (tar failed).');
  } else {
    fs.renameSync(tmp, bin);
  }
  if (process.platform !== 'win32') fs.chmodSync(bin, 0o755);
  if (!works(bin)) throw new Error(`Downloaded cloudflared at ${bin} does not run.`);
  return bin;
}

/**
 * Start a Quick Tunnel to a local URL.
 * @param {{ bin: string, localUrl: string, onLine?: (line: string) => void }} opts
 */
export function startQuickTunnel({ bin, localUrl, onLine = () => {} }) {
  const args = ['tunnel', '--no-autoupdate', '--url', localUrl];
  // A JS "binary" (used by the test suite's fake cloudflared) runs through Node.
  const child = /\.(c|m)?js$/.test(bin)
    ? spawn(process.execPath, [bin, ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    : spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

  const tail = [];
  let resolveUrl;
  let resolveReady;
  const url = new Promise((r) => (resolveUrl = r));
  const ready = new Promise((r) => (resolveReady = r));
  const exited = new Promise((resolve) => {
    child.on('exit', (code, signal) => resolve({ code, signal, tail: tail.join('\n') }));
    child.on('error', (err) => resolve({ code: -1, signal: null, tail: `${tail.join('\n')}\n${err.message}` }));
  });

  let buffer = '';
  const onData = (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      tail.push(line);
      if (tail.length > 40) tail.shift();
      onLine(line);
      const found = findTunnelUrl(line);
      if (found) resolveUrl(found);
      if (/Registered tunnel connection/i.test(line)) resolveReady();
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);

  return {
    child,
    url,
    ready,
    exited,
    stop() {
      if (child.exitCode === null && !child.killed) child.kill(os.platform() === 'win32' ? undefined : 'SIGTERM');
    },
  };
}
