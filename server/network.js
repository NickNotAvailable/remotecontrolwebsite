// @ts-check
import os from 'node:os';

/**
 * LAN IPv4 addresses of this machine, best candidates first. Used to put a phone-reachable URL in
 * the QR code when the TV page itself was opened on http://localhost.
 */
export function lanAddresses() {
  /** @type {{ address: string, score: number }[]} */
  const found = [];
  for (const [name, infos] of Object.entries(os.networkInterfaces())) {
    for (const info of infos || []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      // Skip link-local and typical virtual adapters (docker, VPN, VM bridges).
      if (info.address.startsWith('169.254.')) continue;
      let score = 0;
      if (/^(en|eth|wl|wlan|Wi-Fi|Ethernet)/i.test(name)) score += 2;
      if (/^(docker|br-|veth|vboxnet|vmnet|utun|tun|tap|zt|tailscale)/i.test(name)) score -= 3;
      if (info.address.startsWith('192.168.')) score += 2;
      else if (info.address.startsWith('10.')) score += 1;
      found.push({ address: info.address, score });
    }
  }
  return found.sort((a, b) => b.score - a.score).map((f) => f.address);
}

/**
 * The site's public base URL, used for QR codes. PUBLIC_URL wins; otherwise the URL the hosting
 * platform injects (Render: RENDER_EXTERNAL_URL, Railway: RAILWAY_PUBLIC_DOMAIN, Fly: FLY_APP_NAME).
 * Empty when running locally — the client then falls back to LAN addresses / the page origin.
 */
export function detectPublicUrl(env = process.env) {
  const url =
    env.PUBLIC_URL ||
    env.RENDER_EXTERNAL_URL ||
    (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : '') ||
    (env.FLY_APP_NAME ? `https://${env.FLY_APP_NAME}.fly.dev` : '');
  return url.replace(/\/+$/, '');
}

/**
 * JSON body for GET /api/network.
 * @param {{ port: number, protocol?: string, publicUrl?: string }} opts
 */
export function networkInfo({ port, protocol = 'http', publicUrl = detectPublicUrl() }) {
  return {
    publicUrl: publicUrl.replace(/\/+$/, '') || null,
    lanUrls: lanAddresses().map((ip) => `${protocol}://${ip}:${port}`),
  };
}
