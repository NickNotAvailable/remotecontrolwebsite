import '@fontsource/vt323/400.css';
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource/ibm-plex-mono/400.css';
import '../styles/base.css';
import '../styles/remote.css';

import { site } from '../data/site';
import { h } from '../shared/dom';
import { icons } from '../shared/icons';
import {
  SESSION_LENGTH,
  VOLUME_STEPS,
  formatChannelNumber,
  normalizeSessionId,
  type RemoteCommand,
  type TvState,
} from '../shared/protocol';
import { haptic } from './haptics';
import { RemoteSession, type RemoteView } from './remote-session';
import { keepAwake, releaseAwake } from './wake-lock';

const root = document.getElementById('remote')!;
const html = document.documentElement;
let session: RemoteSession | null = null;
let teardown: (() => void) | null = null;

/* =========================================================================================
   Pairing screen — shown without a code, or after the TV ended the session
   ========================================================================================= */

function showPairScreen(message?: string, prefill = ''): void {
  teardown?.();
  teardown = null;
  html.dataset.view = 'pair';
  const url = new URL(location.href);
  url.searchParams.delete('session');
  history.replaceState(null, '', url);

  const input = h('input', {
    class: 'pair-screen__input',
    attrs: {
      inputmode: 'text',
      autocomplete: 'one-time-code',
      autocapitalize: 'characters',
      spellcheck: 'false',
      maxlength: SESSION_LENGTH + 2,
      placeholder: 'ABC 123',
      'aria-label': 'Pairing code',
      value: prefill,
    },
  });
  const error = h('p', { class: 'pair-screen__error', attrs: { role: 'alert' } });
  const form = h(
    'form',
    {
      class: 'pair-screen__form',
      on: {
        submit: (e) => {
          e.preventDefault();
          const code = normalizeSessionId(input.value);
          if (!code) {
            error.textContent = 'That code doesn’t look right — it’s 6 letters and numbers.';
            haptic('error');
            return;
          }
          haptic('heavy');
          startRemote(code);
        },
      },
    },
    input,
    h('button', { class: 'pair-screen__go', attrs: { type: 'submit' }, text: 'Connect' }),
  );
  input.addEventListener('input', () => {
    input.value = input.value.toUpperCase().replace(/[^A-Z0-9 ]/g, '');
    error.textContent = '';
  });

  root.replaceChildren(
    h(
      'main',
      { class: 'pair-screen' },
      h('div', { class: 'pair-screen__ir' }),
      h('p', { class: 'pair-screen__brand', text: site.ident }),
      h('h1', { class: 'pair-screen__title' }, 'Pair with ', h('br'), 'a screen'),
      message ? h('p', { class: 'pair-screen__message', text: message }) : null,
      h(
        'ol',
        { class: 'pair-screen__steps' },
        h('li', {}, h('span', {}, 'Open ', h('b', { text: location.host }), ' on a computer.')),
        h('li', { text: 'Scan the code in the corner of the screen — or type the 6-character code here.' }),
      ),
      form,
      error,
    ),
  );
}

/* =========================================================================================
   The remote
   ========================================================================================= */

interface Key {
  el: HTMLButtonElement;
}

function startRemote(code: string): void {
  teardown?.();
  const url = new URL(location.href);
  url.searchParams.set('session', code);
  history.replaceState(null, '', url);
  html.dataset.view = 'remote';
  html.dataset.session = code;

  const s = new RemoteSession(code);
  session = s;

  /* ----- LCD (vacuum-fluorescent style display) ----- */
  const lcdChannel = h('span', { class: 'vfd__ch-num' });
  const lcdGhost = h('span', { class: 'vfd__ghost', text: '88' });
  const lcdLink = h('span', { class: 'vfd__flag vfd__flag--link', text: 'LINK' });
  const lcdPlay = h('span', { class: 'vfd__flag vfd__flag--play' });
  const lcdMute = h('span', { class: 'vfd__flag vfd__flag--mute', text: 'MUTE' });
  const lcdLine1 = h('div', { class: 'vfd__line vfd__line--1' });
  const lcdLine2 = h('div', { class: 'vfd__line vfd__line--2' });
  const lcdVolBars = h('span', { class: 'vfd__bars' });
  for (let i = 0; i < VOLUME_STEPS; i++) lcdVolBars.append(h('i'));
  const lcdVolNum = h('span', { class: 'vfd__vol-num' });
  const lcdNotice = h('div', { class: 'vfd__notice', attrs: { 'aria-live': 'polite' } });
  const lcd = h(
    'section',
    { class: 'vfd', attrs: { 'aria-label': 'Remote display' } },
    h(
      'div',
      { class: 'vfd__top' },
      h('span', { class: 'vfd__ch' }, h('span', { class: 'vfd__ch-label', text: 'CH' }), h('span', { class: 'vfd__ch-digits' }, lcdGhost, lcdChannel)),
      h('span', { class: 'vfd__flags' }, lcdLink, lcdPlay, lcdMute),
    ),
    lcdLine1,
    lcdLine2,
    h('div', { class: 'vfd__vol' }, h('span', { class: 'vfd__vol-label', text: 'VOL' }), lcdVolBars, lcdVolNum),
    lcdNotice,
  );

  /* ----- keys ----- */
  const keys: Key[] = [];
  const ir = h('span', { class: 'remote__ir', attrs: { 'aria-hidden': 'true' } });

  function press(el: HTMLElement, cmd: RemoteCommand | (() => void)): void {
    if (typeof cmd === 'function') {
      haptic('tap');
      cmd();
      return;
    }
    const ok = s.send(cmd);
    if (ok) {
      haptic(cmd.type === 'power-toggle' ? 'heavy' : 'tap');
    } else {
      haptic('error');
      el.classList.remove('is-refused');
      void el.offsetWidth;
      el.classList.add('is-refused');
      lcd.classList.remove('is-refused');
      void lcd.offsetWidth;
      lcd.classList.add('is-refused');
    }
  }

  /**
   * A remote key: fires on pointerdown (no 300ms wait), optional auto-repeat while held,
   * still works from a keyboard/switch control via click.
   */
  function key(
    className: string,
    label: string,
    content: string | Node,
    cmd: RemoteCommand | (() => void),
    repeat?: { delay: number; every: number },
  ): HTMLButtonElement {
    const el = h('button', { class: `key ${className}`, attrs: { type: 'button', 'aria-label': label } });
    if (typeof content === 'string') el.innerHTML = content;
    else el.append(content);
    let timer: number | undefined;
    let pointerFired = false;
    const stop = () => {
      window.clearTimeout(timer);
      timer = undefined;
      el.classList.remove('is-pressed');
    };
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      pointerFired = true;
      el.classList.add('is-pressed');
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      keepAwake();
      press(el, cmd);
      if (repeat) {
        const loop = () => {
          press(el, cmd);
          timer = window.setTimeout(loop, repeat.every);
        };
        timer = window.setTimeout(loop, repeat.delay);
      }
    });
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointercancel', stop);
    el.addEventListener('lostpointercapture', stop);
    el.addEventListener('click', () => {
      if (pointerFired) {
        pointerFired = false;
        return;
      }
      press(el, cmd); // keyboard / assistive tech
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    keys.push({ el });
    return el;
  }

  const power = key('key--power', 'Power', icons.power, { type: 'power-toggle' });
  const volUp = key('rocker__half rocker__half--up', 'Volume up', icons.plus, { type: 'volume-step', delta: 1 }, { delay: 380, every: 110 });
  const volDown = key('rocker__half rocker__half--down', 'Volume down', icons.minus, { type: 'volume-step', delta: -1 }, { delay: 380, every: 110 });
  const chUp = key('rocker__half rocker__half--up', 'Channel up', icons.up, { type: 'channel-step', delta: 1 }, { delay: 520, every: 420 });
  const chDown = key('rocker__half rocker__half--down', 'Channel down', icons.down, { type: 'channel-step', delta: -1 }, { delay: 520, every: 420 });
  const mute = key('key--round key--mute', 'Mute', `${icons.muted}<span class="key__cap">MUTE</span>`, { type: 'mute-toggle' });
  const play = key('key--play', 'Play or pause', `<span class="key__glyph">${icons.play}${icons.pause}</span>`, { type: 'play-toggle' });
  const info = key('key--round key--info', 'Show project info on the TV', `${icons.info}<span class="key__cap">INFO</span>`, { type: 'info' });

  const rocker = (label: string, up: HTMLElement, down: HTMLElement) =>
    h('div', { class: 'rocker', attrs: { role: 'group', 'aria-label': label } }, up, h('span', { class: 'rocker__label', text: label }), down);

  const pad = h('div', { class: 'keypad', attrs: { role: 'group', 'aria-label': 'Channel number' } });
  for (const d of [1, 2, 3, 4, 5, 6, 7, 8, 9]) pad.append(key('key--num', `Channel ${d}`, `<span>${d}</span>`, { type: 'digit', digit: d }));
  const guideKey = key('key--num key--fn', 'Open channel guide', `<span class="key__fn">GUIDE</span>`, () => openSheet());
  pad.append(guideKey, key('key--num', 'Digit 0', '<span>0</span>', { type: 'digit', digit: 0 }));
  const lastKey = key('key--num key--fn', 'Previous channel', `<span class="key__fn">CH−</span>`, { type: 'channel-step', delta: -1 });
  pad.append(lastKey);

  /* ----- guide sheet (direct channel selection) ----- */
  const sheetList = h('ol', { class: 'sheet__list' });
  const sheet = h(
    'div',
    { class: 'sheet', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Channels', 'aria-hidden': 'true' } },
    h(
      'div',
      { class: 'sheet__panel' },
      h(
        'header',
        { class: 'sheet__head' },
        h('span', { class: 'sheet__title', text: 'CHANNELS' }),
        h('button', {
          class: 'sheet__close',
          attrs: { type: 'button', 'aria-label': 'Close' },
          html: icons.close,
          on: { click: () => closeSheet() },
        }),
      ),
      sheetList,
    ),
  );
  sheet.addEventListener('click', (e) => e.target === sheet && closeSheet());
  let sheetRenderedFor = '';
  let sheetOpenedAt = 0;

  function renderSheet(state: TvState | null): void {
    if (!state) return;
    const sig = state.lineup.map((c) => c.id).join() + '|' + state.channel;
    if (sig === sheetRenderedFor) return;
    sheetRenderedFor = sig;
    sheetList.replaceChildren(
      ...state.lineup.map((c, i) =>
        h(
          'li',
          {},
          h(
            'button',
            {
              class: `sheet__row${i === state.channel ? ' is-current' : ''}`,
              attrs: { type: 'button', 'data-channel': c.number },
              on: {
                click: (e) => {
                  // The tap that opened the sheet must not also land on a row under the finger.
                  if (performance.now() - sheetOpenedAt < 450) return;
                  const el = e.currentTarget as HTMLButtonElement;
                  press(el, { type: 'channel-set', number: c.number });
                  closeSheet();
                },
              },
            },
            h('span', { class: 'sheet__num', text: formatChannelNumber(c.number) }),
            h('img', { class: 'sheet__thumb', attrs: { src: c.poster, alt: '', loading: 'lazy' } }),
            h('span', { class: 'sheet__text' }, h('b', { text: c.client }), h('span', { text: c.title })),
            h('span', { class: 'sheet__now', text: 'ON' }),
          ),
        ),
      ),
    );
  }
  function openSheet(): void {
    sheetOpenedAt = performance.now();
    renderSheet(s.view.state);
    sheet.classList.add('is-open');
    sheet.setAttribute('aria-hidden', 'false');
  }
  function closeSheet(): void {
    sheet.classList.remove('is-open');
    sheet.setAttribute('aria-hidden', 'true');
  }

  /* ----- assemble ----- */
  const codeLabel = h('span', { class: 'remote__code', text: `${code.slice(0, 3)} ${code.slice(3)}` });
  const disconnect = h('button', {
    class: 'remote__disconnect',
    attrs: { type: 'button' },
    text: 'Disconnect',
    on: {
      click: () => {
        haptic('tap');
        s.leave();
        showPairScreen('Disconnected. Scan the code on the TV to pair again.');
      },
    },
  });

  const body = h(
    'main',
    { class: 'remote', attrs: { 'aria-label': 'TV remote control' } },
    h('div', { class: 'remote__top' }, ir, h('span', { class: 'remote__brand', text: site.ident }), power),
    lcd,
    h(
      'div',
      { class: 'remote__deck' },
      rocker('VOL', volUp, volDown),
      h('div', { class: 'remote__center' }, mute, play, info),
      rocker('CH', chUp, chDown),
    ),
    pad,
    h('footer', { class: 'remote__foot' }, h('span', { class: 'remote__pair' }, 'TV ', codeLabel), disconnect),
    sheet,
  );
  root.replaceChildren(body);

  /* ----- rendering ----- */
  const offTimer = { id: 0 as number | undefined };
  let tvMissingSince = 0;

  function render(view: RemoteView): void {
    if (view.ended) {
      cleanup();
      showPairScreen('The TV ended this session. Scan the new code on the screen.');
      return;
    }
    if (view.error === 'room-full') {
      cleanup();
      showPairScreen('That TV already has the maximum number of remotes connected.');
      return;
    }
    if (view.error === 'version') {
      lcdNotice.textContent = 'UPDATE AVAILABLE — RELOAD THIS PAGE';
    }

    const st = view.state;
    const online = view.link === 'online';
    const tvHere = online && view.tvPresent;
    if (tvHere) tvMissingSince = 0;
    else if (online && !tvMissingSince) tvMissingSince = performance.now();

    let status: string;
    if (!online) status = view.link === 'connecting' ? 'linking' : 'offline';
    else if (!view.tvPresent) status = 'no-tv';
    else if (!st) status = 'syncing';
    else if (!st.power) status = 'standby';
    else status = 'ready';
    html.dataset.status = status;
    body.dataset.status = status;

    lcdLink.classList.toggle('is-on', tvHere);
    lcdLink.classList.toggle('is-blink', !tvHere);

    if (st) {
      const c = st.lineup[st.channel];
      lcdChannel.textContent = st.entry ? st.entry.padEnd(2, '-') : formatChannelNumber(c.number);
      lcdLine1.textContent = c.client.toUpperCase();
      lcdLine2.textContent = c.title.toUpperCase();
      lcdPlay.textContent = st.playing ? '▶ PLAY' : '❚❚ PAUSE';
      lcdMute.classList.toggle('is-on', st.muted);
      [...lcdVolBars.children].forEach((bar, i) => bar.classList.toggle('is-on', i < st.volume));
      lcdVolNum.textContent = String(st.volume).padStart(2, '0');
      lcd.classList.toggle('is-muted', st.muted);
      lcd.classList.toggle('is-tuning', st.tuning);
      play.classList.toggle('is-playing', st.playing);
      mute.classList.toggle('is-active', st.muted);
      power.classList.toggle('is-off', !st.power);
      html.dataset.channel = String(c.number);
      html.dataset.playing = String(st.playing);
      html.dataset.muted = String(st.muted);
      html.dataset.volume = String(st.volume);
      html.dataset.power = String(st.power);
      renderSheet(st);
    } else {
      lcdChannel.textContent = '--';
      lcdLine1.textContent = '';
      lcdLine2.textContent = '';
      lcdPlay.textContent = '';
      lcdVolNum.textContent = '--';
    }

    let notice = '';
    if (status === 'linking') notice = `LINKING TO TV ${code}…`;
    else if (status === 'offline') notice = 'NO SIGNAL · RECONNECTING…';
    else if (status === 'no-tv')
      notice = performance.now() - tvMissingSince > 2500 ? `TV ${code} NOT FOUND · IS THE SITE OPEN?` : 'SEARCHING FOR TV…';
    else if (status === 'syncing') notice = 'SYNCING…';
    else if (status === 'standby') notice = 'STANDBY · PRESS POWER';
    else if (st?.soundBlocked) notice = 'CLICK THE TV SCREEN ONCE TO ALLOW SOUND';
    lcdNotice.textContent = view.error === 'version' ? lcdNotice.textContent : notice;
    lcd.classList.toggle('has-notice', !!notice);
    lcd.dataset.status = status;

    // "TV not found" escalates after a moment; re-render to update the text.
    window.clearTimeout(offTimer.id);
    if (status === 'no-tv') offTimer.id = window.setTimeout(() => render(s.view), 2600);
  }

  const offChange = s.on('change', render);
  const offSent = s.on('sent', () => {
    ir.classList.remove('is-tx');
    void ir.offsetWidth;
    ir.classList.add('is-tx');
  });
  const onVisible = () => document.visibilityState === 'visible' && s.check();
  document.addEventListener('visibilitychange', onVisible);

  function cleanup(): void {
    offChange();
    offSent();
    window.clearTimeout(offTimer.id);
    document.removeEventListener('visibilitychange', onVisible);
    releaseAwake();
    if (session === s) session = null;
  }
  teardown = () => {
    cleanup();
    s.leave();
  };

  render(s.view);
  s.start();
}

/* ----- boot ----------------------------------------------------------------------------- */

const raw = new URLSearchParams(location.search).get('session');
const code = normalizeSessionId(raw);
if (code) startRemote(code);
else showPairScreen(raw ? 'That link’s pairing code isn’t valid. Type the code shown on the TV.' : undefined);
