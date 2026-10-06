import { chromium, devices, expect, type Browser, type Page } from '@playwright/test';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';

/**
 * Sandboxed CI environments often export HTTPS_PROXY; Chromium then tunnels WebSockets to the
 * LAN address through that proxy, which refuses them. Real phones connect directly.
 */
export function envWithoutProxy(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/proxy/i.test(k)) env[k] = v;
  return env;
}

/**
 * The phone runs in its own browser *process* — no shared storage, cookies, BroadcastChannel or
 * memory with the TV. The only way the two can talk is through the network relay.
 */
export async function launchPhone(device = 'iPhone 13'): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch({ env: envWithoutProxy() });
  const context = await browser.newContext({ ...devices[device] });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('[phone pageerror]', e.message));
  return { browser, page };
}

export async function openTv(page: Page, query = ''): Promise<void> {
  page.on('pageerror', (e) => console.error('[tv pageerror]', e.message));
  await page.goto(`/?debug${query ? `&${query}` : ''}`);
  await expect(page.locator('html')).toHaveAttribute('data-link', 'online');
}

export const data = (page: Page, key: string) => page.locator('html').getAttribute(`data-${key}`);

export async function expectData(page: Page, key: string, value: string): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute(`data-${key}`, value);
}

/** Read the QR code off the screen pixels, like a phone camera would. */
export async function scanQr(page: Page): Promise<string> {
  await page.keyboard.press('r');
  const qr = page.locator('.pair__qr--big');
  await expect(qr).toBeVisible();
  const png = PNG.sync.read(await qr.screenshot());
  const result = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  if (!result) throw new Error('QR code could not be decoded');
  await page.keyboard.press('Escape');
  return result.data;
}

/** Wake the TV's auto-hiding control bar, then click a control. */
export async function clickControl(page: Page, action: string): Promise<void> {
  await page.mouse.move(600, 400);
  await page.mouse.move(640, 420);
  await page.locator(`.controls [data-action="${action}"]`).click();
}

export function activeVideo(page: Page) {
  return page.evaluate(() => {
    const n = document.documentElement.dataset.channel;
    const v = document.querySelector<HTMLVideoElement>(`video[data-channel="${n}"]`)!;
    return { channel: Number(n), paused: v.paused, muted: v.muted, volume: v.volume, time: v.currentTime };
  });
}

export async function waitForPlayback(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const v = await activeVideo(page);
      return !v.paused && v.time > 0.3;
    })
    .toBe(true);
}

export const tap = async (phone: Page, label: string) => phone.locator(`[aria-label="${label}"]`).tap();
