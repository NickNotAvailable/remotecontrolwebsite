import { devices, expect, test } from '@playwright/test';
import { activeVideo, expectData, waitForPlayback } from './helpers';

// Emulate the devices in Chromium (the descriptors default to WebKit for Apple devices).
const { defaultBrowserType: _a, ...iPhone } = devices['iPhone 13'];
const { defaultBrowserType: _b, ...iPad } = devices['iPad (gen 7) landscape'];

test.describe('phone visiting the main site', () => {
  test.use(iPhone);

  test('gets the portable TV layout with an inline guide', async ({ page }) => {
    await page.goto('/?debug');
    await expect(page.locator('html')).toHaveClass(/layout-portable/);
    await waitForPlayback(page);
    // no pairing on a phone — it *is* the remote
    await expect(page.locator('.pair')).toHaveCount(0);
    await expect(page.locator('.deck .guide__row')).toHaveCount(8);
    await expect(page.locator('.deck .lt__desc')).toBeVisible();
    await expect(page.locator('.deck .about__email')).toBeVisible();

    // no horizontal scrolling at phone width
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // tap a channel in the guide
    await page.locator('.guide__row[data-channel="4"]').tap();
    await expectData(page, 'channel', '4');

    // controls row
    await page.locator('.deck [data-action="next"]').tap();
    await expectData(page, 'channel', '5');

    // tapping the screen turns the sound on
    await page.locator('.screen__glass').tap();
    await expectData(page, 'muted', 'false');
    expect((await activeVideo(page)).muted).toBe(false);
  });

  test('swipe on the screen changes channel', async ({ page }) => {
    await page.goto('/?debug');
    await expect(page.locator('html')).toHaveClass(/layout-portable/);
    const box = (await page.locator('.screen').boundingBox())!;
    const y = box.y + box.height / 2;
    await page.evaluate(
      ({ y, x0, x1 }) => {
        const el = document.querySelector('.screen')!;
        const touch = (x: number) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
        el.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(x0)], changedTouches: [touch(x0)], bubbles: true }));
        el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [touch(x1)], bubbles: true }));
      },
      { y, x0: box.x + box.width * 0.8, x1: box.x + box.width * 0.2 },
    );
    await expectData(page, 'channel', '2');
  });
});

test.describe('tablet', () => {
  test.use(iPad);

  test('gets the full TV layout with phone pairing', async ({ page }) => {
    await page.goto('/?debug');
    await expect(page.locator('html')).toHaveClass(/layout-tv/);
    await expect(page.locator('.pair')).toBeVisible();
    await waitForPlayback(page);
  });
});

test('narrow desktop window switches layout live', async ({ page }) => {
  await page.goto('/?debug');
  await expect(page.locator('html')).toHaveClass(/layout-tv/);
  await page.setViewportSize({ width: 600, height: 900 });
  await expect(page.locator('html')).toHaveClass(/layout-portable/);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('html')).toHaveClass(/layout-tv/);
  await expect(page.locator('.pair')).toBeVisible();
});
