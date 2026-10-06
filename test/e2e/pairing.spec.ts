import { expect, test, type Browser, type Page } from '@playwright/test';
import { activeVideo, expectData, launchPhone, openTv, scanQr, tap, waitForPlayback } from './helpers';

let phoneBrowser: Browser;
let phone: Page;

test.beforeEach(async () => {
  ({ browser: phoneBrowser, page: phone } = await launchPhone());
});

test.afterEach(async () => {
  await phoneBrowser.close();
});

async function pair(tv: Page): Promise<string> {
  const url = await scanQr(tv);
  await phone.goto(url);
  await expectData(phone, 'status', 'ready');
  await expectData(tv, 'remotes', '1');
  return url;
}

test('QR code encodes this TV session; scanning it pairs a separate phone', async ({ page: tv }) => {
  await openTv(tv);
  const session = await tv.locator('.pair').getAttribute('data-session');
  expect(session).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);

  const url = await scanQr(tv);
  expect(new URL(url).pathname).toBe('/remote');
  expect(new URL(url).searchParams.get('session')).toBe(session);
  // opened via localhost → the QR points at an address the phone can reach on the LAN
  expect(new URL(url).hostname).not.toBe('localhost');

  await phone.goto(url);
  await expectData(phone, 'status', 'ready');
  await expect(phone.locator('.vfd__flag--link')).toHaveClass(/is-on/);
  await expect(phone.locator('.vfd__ch-num')).toHaveText('01');
  await expect(phone.locator('.vfd__line--1')).toHaveText('MEADOW & CO.');

  // connected state on both devices
  await expectData(tv, 'remotes', '1');
  await expect(tv.locator('.pair')).toHaveClass(/is-linked/);
  await expect(tv.locator('.pair__linked')).toContainText('REMOTE LINKED');
  await expect(tv.locator('.osd-toast')).toContainText('REMOTE CONNECTED');
});

test('phone controls the TV: channel, volume, mute, play/pause, digits, guide, power', async ({ page: tv }) => {
  await openTv(tv);
  await waitForPlayback(tv);
  await pair(tv);

  await tap(phone, 'Channel up');
  await expectData(tv, 'channel', '2');
  await expect(phone.locator('.vfd__ch-num')).toHaveText('02');
  await waitForPlayback(tv);
  expect((await activeVideo(tv)).channel).toBe(2);

  await tap(phone, 'Channel down');
  await tap(phone, 'Channel down');
  await expectData(tv, 'channel', '8');

  await tap(phone, 'Volume up');
  await expectData(tv, 'volume', '13');
  await expectData(tv, 'muted', 'false');
  await expect.poll(async () => (await activeVideo(tv)).volume).toBeCloseTo((13 / 20) ** 2, 3);
  await tap(phone, 'Volume down');
  await tap(phone, 'Volume down');
  await expectData(tv, 'volume', '11');
  await expect(phone.locator('.vfd__vol-num')).toHaveText('11');

  await tap(phone, 'Mute');
  await expectData(tv, 'muted', 'true');
  expect((await activeVideo(tv)).muted).toBe(true);
  await expect(phone.locator('.vfd__flag--mute')).toHaveClass(/is-on/);
  await tap(phone, 'Mute');
  await expectData(tv, 'muted', 'false');

  await tap(phone, 'Play or pause');
  await expectData(tv, 'playing', 'false');
  await expect.poll(async () => (await activeVideo(tv)).paused).toBe(true);
  await expect(phone.locator('.vfd__flag--play')).toContainText('PAUSE');
  await tap(phone, 'Play or pause');
  await expectData(tv, 'playing', 'true');
  await waitForPlayback(tv);

  await tap(phone, 'Channel 4');
  await expectData(tv, 'channel', '4');

  await tap(phone, 'Open channel guide');
  await expect(phone.locator('.sheet')).toHaveClass(/is-open/);
  await phone.waitForTimeout(500);
  await phone.locator('.sheet__row[data-channel="6"]').tap();
  await expectData(tv, 'channel', '6');
  await expect(phone.locator('.vfd__line--1')).toHaveText('HEARTH & KILN');

  await tap(phone, 'Show project info on the TV');
  await expect(tv.locator('.lt')).toHaveClass(/is-info/);

  await tap(phone, 'Power');
  await expectData(tv, 'power', 'false');
  await expectData(phone, 'status', 'standby');
  await tap(phone, 'Power');
  await expectData(tv, 'power', 'true');
  await expectData(phone, 'status', 'ready');
});

test('desktop changes update the phone', async ({ page: tv }) => {
  await openTv(tv);
  await pair(tv);
  await tv.keyboard.press('ArrowUp');
  await expect(phone.locator('.vfd__ch-num')).toHaveText('02');
  await tv.keyboard.press('m'); // unmute
  await expect(phone.locator('.vfd__flag--mute')).not.toHaveClass(/is-on/);
  await tv.keyboard.press('-');
  await expect(phone.locator('.vfd__vol-num')).toHaveText('11');
  await tv.keyboard.press(' ');
  await expect(phone.locator('.vfd__flag--play')).toContainText('PAUSE');
  await expect(phone.locator('.key--play')).not.toHaveClass(/is-playing/);
});

test('sound needs one click on the TV: the phone is told, the click applies it', async ({ page: tv }) => {
  // ?autoplay=strict ignores automation's always-on user activation, like a fresh real browser
  await openTv(tv, 'autoplay=strict');
  // Read the pairing URL without touching the TV (pressing a key there would already count as
  // the gesture the browser wants). The phone is the very first thing to interact.
  const url = (await tv.locator('.pair').getAttribute('data-pair-url'))!;
  await phone.goto(url);
  await expectData(phone, 'status', 'ready');

  await tap(phone, 'Volume up');
  await expectData(tv, 'sound-blocked', 'true');
  expect((await activeVideo(tv)).muted).toBe(true); // still playing, just muted
  expect((await activeVideo(tv)).paused).toBe(false);
  await expect(tv.locator('.sound-prompt')).toHaveClass(/is-urgent/);
  await expect(phone.locator('.vfd__notice')).toContainText('CLICK THE TV SCREEN');

  await tv.mouse.click(700, 300);
  await expectData(tv, 'sound-blocked', 'false');
  await expect.poll(async () => (await activeVideo(tv)).muted).toBe(false);
  await expect(phone.locator('.vfd__notice')).toHaveText('');
});

test('rapid presses stay in order (optimistic UI reconciles with the TV)', async ({ page: tv }) => {
  await openTv(tv);
  await pair(tv);
  for (let i = 0; i < 5; i++) await tap(phone, 'Volume up');
  await expectData(tv, 'volume', '17');
  await expect(phone.locator('.vfd__vol-num')).toHaveText('17');
  for (let i = 0; i < 3; i++) await tap(phone, 'Channel up');
  await expectData(tv, 'channel', '4');
  await expectData(tv, 'tuning', 'false');
  await expect(phone.locator('.vfd__ch-num')).toHaveText('04');
});

test('manual code entry on /remote pairs with the TV', async ({ page: tv }) => {
  await openTv(tv);
  const session = (await tv.locator('.pair').getAttribute('data-session'))!;
  await phone.goto('/remote');
  await expectData(phone, 'view', 'pair');
  await phone.locator('.pair-screen__input').fill(`${session.slice(0, 3).toLowerCase()} ${session.slice(3)}`);
  await phone.locator('.pair-screen__go').tap();
  await expectData(phone, 'status', 'ready');
  await expectData(tv, 'remotes', '1');
  expect(new URL(phone.url()).searchParams.get('session')).toBe(session);
});

test('two phones can share one TV and both stay in sync', async ({ page: tv }) => {
  await openTv(tv);
  const url = await pair(tv);
  const second = await launchPhone('Pixel 7');
  try {
    await second.page.goto(url);
    await expectData(second.page, 'status', 'ready');
    await expectData(tv, 'remotes', '2');
    await tap(second.page, 'Channel up');
    await expectData(tv, 'channel', '2');
    await expect(phone.locator('.vfd__ch-num')).toHaveText('02');
  } finally {
    await second.browser.close();
  }
});

test('"New code" disconnects phones and issues a fresh session', async ({ page: tv }) => {
  await openTv(tv);
  await pair(tv);
  const before = await tv.locator('.pair').getAttribute('data-session');
  await tv.keyboard.press('r');
  await tv.locator('.pair__new').click();
  await expect(tv.locator('.pair')).not.toHaveAttribute('data-session', before!);
  await expectData(phone, 'view', 'pair');
  await expect(phone.locator('.pair-screen__message')).toContainText('ended this session');
  await expectData(tv, 'remotes', '0');
});

test('phone "Disconnect" leaves cleanly', async ({ page: tv }) => {
  await openTv(tv);
  await pair(tv);
  await phone.locator('.remote__disconnect').tap();
  await expectData(phone, 'view', 'pair');
  await expectData(tv, 'remotes', '0');
  await expect(tv.locator('.osd-toast').last()).toContainText('REMOTE DISCONNECTED');
});
