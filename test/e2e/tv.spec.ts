import { expect, test } from '@playwright/test';
import { activeVideo, clickControl, data, expectData, openTv, waitForPlayback } from './helpers';

test.describe('desktop TV', () => {
  test('loads as a TV and plays the first channel', async ({ page }) => {
    await openTv(page);
    await expectData(page, 'renderer', 'webgl');
    await expectData(page, 'channel', '1');
    await expect(page.locator('.lt__client')).toHaveText('Meadow & Co.');
    await expect(page.locator('.sound-prompt')).toHaveClass(/is-visible/);
    await waitForPlayback(page);
    // starts muted so autoplay is always allowed
    expect((await activeVideo(page)).muted).toBe(true);
    // all channels exist up front so they can buffer ahead of time
    await expect(page.locator('video.channel-video')).toHaveCount(8);
  });

  test('channel change runs the static transition, then plays the next video', async ({ page }) => {
    await openTv(page);
    await waitForPlayback(page);

    // sample the effect parameters every frame while the channel changes
    const samples = page.evaluate(
      () =>
        new Promise<{ noise: number; rgb: number; glitch: number; tuning: boolean[] }>((resolve) => {
          const fx = (window as any).__tv.fx;
          const out = { noise: 0, rgb: 0, glitch: 0, tuning: [] as boolean[] };
          const start = performance.now();
          const tick = () => {
            out.noise = Math.max(out.noise, fx.params.noise);
            out.rgb = Math.max(out.rgb, fx.params.rgb);
            out.glitch = Math.max(out.glitch, fx.params.glitch);
            out.tuning.push(document.documentElement.dataset.tuning === 'true');
            if (performance.now() - start < 900) requestAnimationFrame(tick);
            else resolve(out);
          };
          requestAnimationFrame(tick);
        }),
    );
    await page.keyboard.press('ArrowUp');
    const fx = await samples;
    expect(fx.noise).toBeGreaterThan(0.8); // full-screen snow
    expect(fx.rgb).toBeGreaterThan(2); // chromatic split
    expect(fx.glitch).toBeGreaterThan(0.5); // line tearing
    expect(fx.tuning).toContain(true);

    await expectData(page, 'channel', '2');
    await expectData(page, 'tuning', 'false');
    await expect(page.locator('.osd-channel__num')).toHaveText('CH 02');
    await expect(page.locator('.lt__client')).toHaveText('Lumen');
    await waitForPlayback(page);
    // the previous channel stops once it's off screen
    const ch1Paused = await page.evaluate(() => document.querySelector<HTMLVideoElement>('video[data-channel="1"]')!.paused);
    expect(ch1Paused).toBe(true);
    expect(page.url()).toContain('channel=2');
  });

  test('on-screen controls: prev/next, play/pause, mute, volume, power', async ({ page }) => {
    await openTv(page);
    await waitForPlayback(page);

    await clickControl(page, 'next');
    await expectData(page, 'channel', '2');
    await clickControl(page, 'prev');
    await expectData(page, 'channel', '1');
    await clickControl(page, 'prev');
    await expectData(page, 'channel', '8'); // wraps around

    await clickControl(page, 'play');
    await expectData(page, 'playing', 'false');
    expect((await activeVideo(page)).paused).toBe(true);
    await expect(page.locator('.osd-flag--pause')).toBeVisible();
    await clickControl(page, 'play');
    await expectData(page, 'playing', 'true');

    await clickControl(page, 'mute'); // unmute (a real click = sound is allowed)
    await expectData(page, 'muted', 'false');
    expect((await activeVideo(page)).muted).toBe(false);
    await expect(page.locator('.sound-prompt')).not.toHaveClass(/is-visible/);

    await page.locator('.ctl-volume__input').fill('5');
    await expectData(page, 'volume', '5');
    expect((await activeVideo(page)).volume).toBeCloseTo((5 / 20) ** 2, 3);

    await clickControl(page, 'power');
    await expectData(page, 'power', 'false');
    await expect(page.locator('.osd-standby')).toHaveClass(/is-visible/);
    await expect.poll(async () => (await activeVideo(page)).paused).toBe(true);
    await clickControl(page, 'power');
    await expectData(page, 'power', 'true');
    await waitForPlayback(page);
  });

  test('keyboard: arrows, direct digit entry, volume, mute, guide', async ({ page }) => {
    await openTv(page);
    await page.keyboard.press('ArrowRight');
    await expectData(page, 'channel', '2');
    await page.keyboard.press('ArrowDown');
    await expectData(page, 'channel', '1');

    await page.keyboard.press('5'); // 5×10 > 8 channels → tunes immediately
    await expectData(page, 'channel', '5');
    await page.keyboard.press('0'); // "0-" waits for a second digit, like a real TV
    await expect(page.locator('.osd-channel__num')).toHaveText('CH 0-');
    await page.keyboard.press('7');
    await expectData(page, 'channel', '7');

    await page.keyboard.press('+');
    await expectData(page, 'volume', '13');
    await expectData(page, 'muted', 'false'); // volume up unmutes
    await expect(page.locator('.osd-volume')).toHaveClass(/is-visible/);
    await page.keyboard.press('m');
    await expectData(page, 'muted', 'true');

    await page.keyboard.press('g');
    await expect(page.locator('.guide')).toHaveClass(/is-open/);
    await page.locator('.guide__row[data-channel="3"]').click();
    await expect(page.locator('.guide')).not.toHaveClass(/is-open/);
    await expectData(page, 'channel', '3');

    await page.keyboard.press('i');
    await expect(page.locator('.lt')).toHaveClass(/is-info/);
    await expect(page.locator('.lt__desc')).toBeVisible();
  });

  test('deep link to a channel', async ({ page }) => {
    await page.goto('/?channel=6');
    await expectData(page, 'channel', '6');
    expect(await data(page, 'renderer')).toBe('webgl');
  });

  test('DOM fallback renderer still plays and transitions', async ({ page }) => {
    await openTv(page, 'renderer=dom');
    await expectData(page, 'renderer', 'dom');
    await waitForPlayback(page);
    await page.keyboard.press('ArrowUp');
    await expectData(page, 'channel', '2');
    await expectData(page, 'tuning', 'false');
    await expect(page.locator('video[data-channel="2"]')).toHaveClass(/is-on-air/);
    await waitForPlayback(page);
  });
});
