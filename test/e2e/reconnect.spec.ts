import { expect, test, type Browser, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { expectData, launchPhone, openTv, scanQr, tap } from './helpers';

/**
 * Disconnect / reconnect scenarios. These run against their own server process so the test can
 * kill and restart the relay underneath both devices.
 */
const PORT = 4391;
const BASE = `http://localhost:${PORT}`;
let server: ChildProcess | null = null;

async function startServer(): Promise<void> {
  server = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(`${BASE}/healthz`)).ok;
        } catch {
          return false;
        }
      },
      { timeout: 10_000 },
    )
    .toBe(true);
}

async function stopServer(): Promise<void> {
  if (!server) return;
  const s = server;
  server = null;
  await new Promise<void>((resolve) => {
    s.once('exit', () => resolve());
    s.kill('SIGKILL'); // abrupt, like a crashed relay or dropped network
  });
}

let phoneBrowser: Browser;
let phone: Page;

test.beforeEach(async () => {
  await startServer();
  ({ browser: phoneBrowser, page: phone } = await launchPhone());
});

test.afterEach(async () => {
  await phoneBrowser.close();
  await stopServer();
});

async function pair(tv: Page): Promise<string> {
  await tv.goto(`${BASE}/?debug`);
  await expectData(tv, 'link', 'online');
  const url = await scanQr(tv);
  await phone.goto(url);
  await expectData(phone, 'status', 'ready');
  await expectData(tv, 'remotes', '1');
  return url;
}

test('relay goes down and comes back: both devices recover on their own', async ({ page: tv }) => {
  await pair(tv);
  await tap(phone, 'Channel up');
  await expectData(tv, 'channel', '2');

  await stopServer();
  await expectData(phone, 'status', 'offline');
  await expect(phone.locator('.vfd__notice')).toContainText('NO SIGNAL');
  // the TV keeps working on its own while the relay is away
  await tv.keyboard.press('ArrowUp');
  await expectData(tv, 'channel', '3');
  // pressing a button while disconnected is refused, not queued
  await tap(phone, 'Channel up');
  await expect(phone.locator('[aria-label="Channel up"]')).toHaveClass(/is-refused/);

  await startServer();
  await expectData(tv, 'link', 'online');
  await expectData(phone, 'status', 'ready');
  await expectData(tv, 'remotes', '1');
  // the phone catches up with what happened while it was offline
  await expect(phone.locator('.vfd__ch-num')).toHaveText('03');
  await tap(phone, 'Channel up');
  await expectData(tv, 'channel', '4');
});

test('reloading the TV keeps the phone paired (same code)', async ({ page: tv }) => {
  const url = await pair(tv);
  await tap(phone, 'Channel up');
  await expectData(tv, 'channel', '2');
  const session = new URL(url).searchParams.get('session');

  await tv.reload();
  await expectData(tv, 'link', 'online');
  await expect(tv.locator('.pair')).toHaveAttribute('data-session', session!);
  await expectData(tv, 'remotes', '1');
  await expectData(phone, 'status', 'ready');
  await tap(phone, 'Channel up');
  await expectData(tv, 'channel', '3');
});

test('closing the TV tab: the phone waits, then pairs again when the TV is back', async ({ page: tv, context }) => {
  const url = await pair(tv);
  await tv.close();
  await expectData(phone, 'status', 'no-tv');
  await expect(phone.locator('.vfd__notice')).toContainText(/SEARCHING|NOT FOUND/);

  // The same TV comes back (sessionStorage is per tab, so emulate "restore tab" with the same code).
  const tv2 = await context.newPage();
  const session = new URL(url).searchParams.get('session')!;
  await tv2.addInitScript((code) => sessionStorage.setItem('tv.session', code), session);
  await tv2.goto(`${BASE}/?debug`);
  await expectData(tv2, 'link', 'online');
  await expectData(phone, 'status', 'ready');
  await tap(phone, 'Channel up');
  await expectData(tv2, 'channel', '2');
});

test('reloading the phone reconnects it to the same TV', async ({ page: tv }) => {
  await pair(tv);
  await phone.reload();
  await expectData(phone, 'status', 'ready');
  await expect.poll(async () => tv.locator('html').getAttribute('data-remotes')).toBe('1');
  await tap(phone, 'Mute');
  await expectData(tv, 'muted', 'false');
});
