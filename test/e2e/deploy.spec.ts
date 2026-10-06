import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { expectData, scanQr } from './helpers';

/**
 * Hosted deployments: the server learns its public URL from the platform (Render injects
 * RENDER_EXTERNAL_URL) and the TV's QR code must use it — never localhost or a container IP.
 */
const PORT = 4392;
const BASE = `http://localhost:${PORT}`;
const PUBLIC = 'https://channel-surf-tv.onrender.com';
let server: ChildProcess | null = null;

test.beforeAll(async () => {
  const env = { ...process.env, PORT: String(PORT), RENDER_EXTERNAL_URL: PUBLIC };
  delete env.PUBLIC_URL;
  server = spawn(process.execPath, ['server/index.js'], { env, stdio: 'ignore' });
  await expect
    .poll(async () => (await fetch(`${BASE}/healthz`).catch(() => null))?.ok ?? false, { timeout: 10_000 })
    .toBe(true);
});

test.afterAll(() => {
  server?.kill('SIGKILL');
});

test('server advertises the platform URL', async () => {
  const info = await (await fetch(`${BASE}/api/network`)).json();
  expect(info.publicUrl).toBe(PUBLIC);
});

test('QR code points at the public /remote URL for this session', async ({ page }) => {
  await page.goto(`${BASE}/?debug`);
  await expectData(page, 'link', 'online');
  const session = await page.locator('.pair').getAttribute('data-session');
  const qr = new URL(await scanQr(page));
  expect(qr.origin).toBe(PUBLIC);
  expect(qr.pathname).toBe('/remote');
  expect(qr.searchParams.get('session')).toBe(session);
  await page.keyboard.press('r');
  await expect(page.locator('.pair__host')).toHaveText('channel-surf-tv.onrender.com/remote');
  // no "same Wi-Fi" warning on a public deployment
  await expect(page.locator('.pair__note')).toBeHidden();
});
