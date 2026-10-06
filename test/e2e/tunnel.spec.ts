import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { expectData, launchPhone, scanQr, tap } from './helpers';

/**
 * `npm run tunnel` end to end, with a stand-in for cloudflared that prints the same output a real
 * Quick Tunnel does. Proves the server adopts the tunnel URL and the TV's QR code uses it.
 * (The Cloudflare hop itself can't run in CI.)
 */
const PORT = 4398;
const LOCAL = `http://127.0.0.1:${PORT}`;
const TUNNEL = 'https://quiet-test-signal.trycloudflare.com';
const FAKE = path.resolve('test/fixtures/fake-cloudflared.mjs');

function runTunnel(extraEnv: Record<string, string> = {}) {
  const child = spawn(process.execPath, ['scripts/tunnel.mjs', '--no-open', '--no-build', '--port', String(PORT)], {
    env: { ...process.env, CLOUDFLARED_BIN: FAKE, TUNNEL_SKIP_PROBE: '1', FAKE_TUNNEL_URL: TUNNEL, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout!.on('data', (d) => (output += d));
  child.stderr!.on('data', (d) => (output += d));
  const exited = new Promise<number | null>((r) => child.on('exit', (code) => r(code)));
  return { child, exited, output: () => output };
}

test.describe('npm run tunnel', () => {
  let tunnel: ReturnType<typeof runTunnel> & { child: ChildProcess };

  test.beforeAll(async () => {
    tunnel = runTunnel();
    await expect.poll(() => tunnel.output(), { timeout: 20_000 }).toContain('Live on the public internet');
  });

  test.afterAll(async () => {
    tunnel.child.kill('SIGTERM');
    await tunnel.exited;
  });

  test('prints the public URL and the server advertises it (no LAN addresses)', async () => {
    expect(tunnel.output()).toContain(TUNNEL);
    const info = await (await fetch(`${LOCAL}/api/network`)).json();
    expect(info).toEqual({ publicUrl: TUNNEL, lanUrls: [] });
  });

  test('QR code on the TV points at the tunnel, and its session pairs a phone', async ({ page }) => {
    await page.goto(`${LOCAL}/?debug`);
    await expectData(page, 'link', 'online');
    const session = await page.locator('.pair').getAttribute('data-session');
    const qr = new URL(await scanQr(page));
    expect(qr.origin).toBe(TUNNEL);
    expect(qr.pathname).toBe('/remote');
    expect(qr.searchParams.get('session')).toBe(session);

    // The phone follows the QR's path + session (served by the same server the tunnel fronts).
    const phone = await launchPhone();
    try {
      await phone.page.goto(`${LOCAL}${qr.pathname}${qr.search}`);
      await expectData(phone.page, 'status', 'ready');
      await tap(phone.page, 'Channel up');
      await expectData(page, 'channel', '2');
    } finally {
      await phone.browser.close();
    }
  });
});

test('a failed tunnel exits with a clear message', async () => {
  const t = runTunnel({ FAKE_TUNNEL_FAIL: '1' });
  expect(await t.exited).toBe(1);
  expect(t.output()).toContain('cloudflared stopped');
  expect(t.output()).toContain('quick tunnel provisioning failed');
});
