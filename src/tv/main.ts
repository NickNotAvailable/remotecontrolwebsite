import '@fontsource/vt323/400.css';
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '../styles/base.css';
import '../styles/tv.css';

import { channels } from '../data/channels';
import { config } from '../shared/config';
import { site } from '../data/site';
import { h } from '../shared/dom';
import { icons } from '../shared/icons';
import { formatChannelNumber } from '../shared/protocol';
import { Fx } from './fx';
import { bindSwipe } from './input/gestures';
import { bindKeyboard } from './input/keyboard';
import { TvPairing } from './pairing';
import { ChannelPlayer } from './player';
import { DomRenderer } from './renderer/dom-renderer';
import type { Renderer, RendererOptions } from './renderer/types';
import { WebGLRenderer } from './renderer/webgl-renderer';
import { Sfx } from './sfx';
import { TvController } from './tv-controller';
import { Controls } from './ui/controls';
import { Guide } from './ui/guide';
import { LowerThird } from './ui/lower-third';
import { Osd } from './ui/osd';
import { PairingPanel } from './ui/pairing-panel';
import { SoundPrompt } from './ui/sound-prompt';

/** Phones in portrait get the "portable TV" layout; everything else is the full-screen TV. */
const PORTABLE_QUERY = '(max-width: 760px)';
const html = document.documentElement;
const params = new URLSearchParams(location.search);
const touch = matchMedia('(pointer: coarse)').matches;
const isPhone = touch && Math.min(screen.width, screen.height) < 600;
const canPair = config.pairing && (!isPhone || params.has('pair'));
let portable = matchMedia(PORTABLE_QUERY).matches;

/* ----- the screen ------------------------------------------------------------------------ */

const app = document.getElementById('app')!;
const videoHost = h('div', { class: 'screen__videos' });
const canvas = h('canvas', { class: 'screen__canvas', attrs: { 'aria-hidden': 'true' } });
const tvScreen = h(
  'main',
  { class: 'screen', attrs: { id: 'screen', 'aria-label': `${site.name} — channels` } },
  videoHost,
  canvas,
  h('div', { class: 'screen__glass', attrs: { 'aria-hidden': 'true' } }),
  h('div', { class: 'screen__scrim', attrs: { 'aria-hidden': 'true' } }),
);
const deck = h('div', { class: 'deck' });
app.append(tvScreen, deck);

const initial = Math.max(
  0,
  channels.findIndex((c) => c.number === Number(params.get('channel'))),
);

// `?autoplay=strict` simulates a browser that hasn't seen a click yet (handy for testing the sound prompt).
const player = new ChannelPlayer(channels, videoHost, !portable, params.get('autoplay') === 'strict');
const fx = new Fx();
const sfx = new Sfx();
let renderer: Renderer;
const rendererOptions: RendererOptions = {
  screen: tvScreen,
  canvas,
  fx,
  onFatal: (reason) => {
    console.warn(`[tv] WebGL renderer stopped (${reason}); using DOM renderer`);
    renderer = new DomRenderer(rendererOptions);
    renderer.setFit(fitMode());
    tv.useRenderer(renderer);
    renderer.start();
  },
};
const forceDom = params.get('renderer') === 'dom';
try {
  renderer = forceDom ? new DomRenderer(rendererOptions) : new WebGLRenderer(rendererOptions);
} catch (err) {
  console.warn('[tv] WebGL unavailable, using DOM renderer', err);
  renderer = new DomRenderer(rendererOptions);
}
html.dataset.renderer = renderer.kind;

const tv = new TvController(player, fx, renderer, sfx, initial);
renderer.start();

function fitMode() {
  const r = tvScreen.getBoundingClientRect();
  const aspect = r.width / Math.max(1, r.height);
  // Fill the screen like a TV would (a little overscan is fine), but never crop more than ~15%
  // of a 16:9 film: ultrawide monitors get pillarboxed, tall windows get letterboxed.
  const crop = 1 - Math.min(aspect / (16 / 9), 16 / 9 / aspect);
  return crop <= 0.15 ? 'cover' : 'contain';
}
const applyFit = () => renderer.setFit(fitMode());
new ResizeObserver(applyFit).observe(tvScreen);
applyFit();

/* ----- on-screen graphics + controls ------------------------------------------------------ */

const osd = new Osd(tv);
const ident = h(
  'div',
  { class: 'ident' },
  h('span', { class: 'ident__name', text: site.ident }),
  h('span', { class: 'ident__sub', text: site.identSub }),
);
const soundPrompt = new SoundPrompt(tv, touch);
const lowerThird = new LowerThird(tv);
const guide = new Guide(tv);

let pairing: TvPairing | null = null;
let panel: PairingPanel | null = null;
if (canPair) {
  pairing = new TvPairing(tv);
  panel = new PairingPanel(pairing);
  panel.onExpandChange = () => wake();
}

// Static previews have no relay to pair through; say so where the QR code would be.
const pairingNote = config.pairing
  ? null
  : h(
      'aside',
      { class: 'pair-off', attrs: { 'aria-label': 'Phone remote' } },
      h('span', { class: 'pair-off__icon', html: icons.phone }),
      h('span', { class: 'pair-off__text' }, h('b', { text: 'Phone remote' }), h('span', { text: 'Not available in this preview' })),
    );

const fullscreenSupported = !!document.documentElement.requestFullscreen;
const controls = new Controls(
  tv,
  {
    toggleGuide: () => guide.toggle(),
    toggleRemotePanel: () => panel?.toggle(),
    toggleFullscreen,
  },
  { volumeControllable: player.volumeControllable, fullscreen: fullscreenSupported, pairing: canPair },
);

tvScreen.append(osd.root, ident, soundPrompt.root);

const footer = h(
  'footer',
  { class: 'deck__footer' },
  h('span', { class: 'deck__footer-icon', html: icons.phone }),
  h(
    'p',
    {},
    h('b', { text: 'Better on a big screen.' }),
    ' Open this site on a computer and your phone becomes the remote control.',
  ),
);

function applyLayout(): void {
  html.classList.toggle('layout-portable', portable);
  html.classList.toggle('layout-tv', !portable);
  guide.setInline(portable);
  if (portable) {
    deck.append(controls.root, lowerThird.root, guide.root, footer);
    panel?.root.remove();
    pairingNote?.remove();
  } else {
    tvScreen.append(lowerThird.root, controls.root);
    if (panel) tvScreen.append(panel.root);
    if (pairingNote) tvScreen.append(pairingNote);
    tvScreen.append(guide.root);
  }
}
applyLayout();
matchMedia(PORTABLE_QUERY).addEventListener('change', (e) => {
  portable = e.matches;
  applyLayout();
});

/* ----- awake / idle (controls fade away while watching) ----------------------------------- */

let awakeTimer: number | undefined;
function pinned(): boolean {
  return guide.isOpen || !!panel?.isExpanded || lowerThird.infoOpen || controls.root.matches(':hover');
}
function wake(ms = 3200): void {
  html.classList.add('is-awake');
  window.clearTimeout(awakeTimer);
  awakeTimer = window.setTimeout(function sleep() {
    if (pinned()) awakeTimer = window.setTimeout(sleep, 1000);
    else html.classList.remove('is-awake');
  }, ms);
}
window.addEventListener('pointermove', (e) => e.pointerType === 'mouse' && wake());
window.addEventListener('pointerdown', () => wake());
guide.onClose = () => wake();
wake(5000);

/* ----- input -------------------------------------------------------------------------------- */

// Any first gesture on the page lets WebAudio (static, power thump) start.
const unlockSfx = () => sfx.unlock();
window.addEventListener('pointerdown', unlockSfx, { capture: true });
window.addEventListener('keydown', unlockSfx, { capture: true });

tvScreen.addEventListener('click', () => {
  if (!tv.state.power) return;
  if (tv.state.muted && !tv.everUnmuted) {
    tv.setMuted(false);
    return;
  }
  if (touch && html.classList.contains('is-awake') && !portable) html.classList.remove('is-awake');
  else wake();
});
tvScreen.addEventListener('dblclick', (e) => {
  if (!portable && e.target === tvScreen.querySelector('.screen__glass')) toggleFullscreen();
});
bindSwipe(tvScreen, (dir) => tv.step(dir));

function toggleFullscreen(): void {
  if (!fullscreenSupported) return;
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen().catch(() => {});
}

bindKeyboard(tv, {
  guide,
  toggleRemotePanel: () => panel?.toggle(),
  toggleFullscreen,
  wake: () => wake(),
  closeOverlays: () => {
    let closed = false;
    if (panel?.isExpanded) {
      panel.setExpanded(false);
      closed = true;
    }
    if (lowerThird.infoOpen) {
      lowerThird.hideInfo();
      closed = true;
    }
    return closed;
  },
});

/* ----- pairing feedback ------------------------------------------------------------------- */

if (pairing && panel) {
  pairing.on('joined', (peer) => {
    osd.toast(`REMOTE CONNECTED · ${peer.label || 'PHONE'}`.toUpperCase(), 'good');
    panel!.setExpanded(false);
  });
  pairing.on('left', () => osd.toast('REMOTE DISCONNECTED', 'warn'));
  pairing.on('remotes', (remotes) => {
    controls.setRemoteCount(remotes.length);
    html.dataset.remotes = String(remotes.length);
  });
  pairing.on('status', (status) => (html.dataset.link = status));
  void pairing.start();
}

/* ----- reflect state for styling, deep links and tests ------------------------------------ */

function reflect(s: typeof tv.state): void {
  html.dataset.channel = String(channels[s.channel].number);
  html.dataset.playing = String(s.playing);
  html.dataset.muted = String(s.muted);
  html.dataset.volume = String(s.volume);
  html.dataset.power = String(s.power);
  html.dataset.soundBlocked = String(s.soundBlocked);
  html.dataset.tuning = String(s.tuning);
}
function retitle(index: number, updateUrl: boolean): void {
  const c = channels[index];
  document.title = `CH ${formatChannelNumber(c.number)} · ${c.client} — ${site.name}`;
  if (!updateUrl) return;
  const url = new URL(location.href);
  url.searchParams.set('channel', String(c.number));
  try {
    history.replaceState(null, '', url);
  } catch {
    /* sandboxed frames may refuse URL changes; deep links are a nicety */
  }
}
tv.on('change', reflect);
tv.on('tuneStart', ({ index }) => retitle(index, true));
// Remote-driven changes shouldn't pop the desktop control bar up.
tv.on('remoteCommand', () => html.classList.remove('is-awake'));
reflect(tv.state);
retitle(tv.state.channel, false);

if (params.has('debug')) {
  Object.assign(window, { __tv: { tv, player, fx, pairing, get renderer() { return renderer; } } });
}
