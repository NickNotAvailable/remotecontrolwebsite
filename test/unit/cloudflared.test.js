import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findTunnelUrl, releaseAsset } from '../../scripts/lib/cloudflared.mjs';

test('finds the quick tunnel URL in real cloudflared output', () => {
  const banner = '2026-10-06T06:33:31Z INF |  https://calm-river-sunset-k9.trycloudflare.com                                          |';
  assert.equal(findTunnelUrl(banner), 'https://calm-river-sunset-k9.trycloudflare.com');
  // lines that mention trycloudflare.com but are not the tunnel URL
  assert.equal(findTunnelUrl('INF Requesting new quick Tunnel on trycloudflare.com...'), null);
  assert.equal(findTunnelUrl('ERR failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": EOF'), null);
  assert.equal(findTunnelUrl('INF Registered tunnel connection connIndex=0'), null);
});

test('picks the right cloudflared release for each platform', () => {
  assert.deepEqual(releaseAsset('darwin', 'arm64'), { name: 'cloudflared-darwin-arm64.tgz', tgz: true, exe: 'cloudflared' });
  assert.deepEqual(releaseAsset('darwin', 'x64'), { name: 'cloudflared-darwin-amd64.tgz', tgz: true, exe: 'cloudflared' });
  assert.equal(releaseAsset('linux', 'x64').name, 'cloudflared-linux-amd64');
  assert.equal(releaseAsset('linux', 'arm64').name, 'cloudflared-linux-arm64');
  assert.equal(releaseAsset('win32', 'x64').name, 'cloudflared-windows-amd64.exe');
  assert.equal(releaseAsset('win32', 'arm64').exe, 'cloudflared.exe');
  assert.equal(releaseAsset('freebsd', 'x64'), null);
});
