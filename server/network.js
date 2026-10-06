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
 * JSON body for GET /api/network.
 * @param {{ port: number, protocol?: string, publicUrl?: string }} opts
 */
export function networkInfo({ port, protocol = 'http', publicUrl = process.env.PUBLIC_URL || '' }) {
  return {
    publicUrl: publicUrl.replace(/\/+$/, '') || null,
    lanUrls: lanAddresses().map((ip) => `${protocol}://${ip}:${port}`),
  };
}
