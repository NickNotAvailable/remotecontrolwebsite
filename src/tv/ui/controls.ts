import { h } from '../../shared/dom';
import { icons } from '../../shared/icons';
import { VOLUME_STEPS, type TvState } from '../../shared/protocol';
import type { TvController } from '../tv-controller';

export interface ControlsActions {
  toggleGuide(): void;
  toggleRemotePanel(): void;
  toggleFullscreen(): void;
}

/** On-screen control strip (desktop) / control row (portable). */
export class Controls {
  readonly root: HTMLElement;
  private playBtn: HTMLButtonElement;
  private muteBtn: HTMLButtonElement;
  private powerBtn: HTMLButtonElement;
  private volume: HTMLInputElement;
  private volumeWrap: HTMLElement;
  private remoteBtn: HTMLButtonElement;

  constructor(
    tv: TvController,
    actions: ControlsActions,
    opts: { volumeControllable: boolean; fullscreen: boolean; pairing: boolean },
  ) {
    const btn = (name: string, label: string, icon: string, onClick: () => void, extra = '') =>
      h('button', {
        class: `ctl ctl--${name} ${extra}`,
        attrs: { type: 'button', 'aria-label': label, title: label, 'data-action': name },
        html: `${icon}<span class="ctl__label">${label}</span>`,
        on: { click: (e) => (e.stopPropagation(), onClick()) },
      });

    this.powerBtn = btn('power', 'Power', icons.power, () => tv.togglePower());
    const prev = btn('prev', 'Previous channel', icons.prev, () => tv.step(-1));
    const next = btn('next', 'Next channel', icons.next, () => tv.step(1));
    this.playBtn = btn('play', 'Pause', icons.pause, () => tv.togglePlay());
    this.muteBtn = btn('mute', 'Mute', icons.volume, () => tv.toggleMute());

    this.volume = h('input', {
      class: 'ctl-volume__input',
      attrs: { type: 'range', min: 0, max: VOLUME_STEPS, step: 1, 'aria-label': 'Volume', 'data-action': 'volume' },
    });
    this.volume.addEventListener('input', () => tv.setVolume(Number(this.volume.value)));
    this.volume.addEventListener('click', (e) => e.stopPropagation());
    this.volumeWrap = h('label', { class: 'ctl-volume' }, this.volume);
    if (!opts.volumeControllable) this.volumeWrap.hidden = true;

    const guide = btn('guide', 'Guide', icons.guide, () => actions.toggleGuide());
    this.remoteBtn = btn('remote', 'Phone remote', icons.phone, () => actions.toggleRemotePanel());
    if (!opts.pairing) this.remoteBtn.hidden = true;
    const fs = btn('fullscreen', 'Full screen', icons.fullscreen, () => actions.toggleFullscreen());
    if (!opts.fullscreen) fs.hidden = true;

    this.root = h(
      'nav',
      { class: 'controls', attrs: { 'aria-label': 'TV controls' } },
      h('div', { class: 'controls__group' }, this.powerBtn),
      h('div', { class: 'controls__group controls__group--channel' }, prev, h('span', { class: 'controls__ch', text: 'CH' }), next),
      h('div', { class: 'controls__group' }, this.playBtn, this.muteBtn, this.volumeWrap),
      h('div', { class: 'controls__group' }, guide, this.remoteBtn, fs),
    );
    tv.on('change', (s) => this.render(s));
    this.render(tv.state);
  }

  setRemoteCount(count: number): void {
    this.remoteBtn.classList.toggle('is-linked', count > 0);
    this.remoteBtn.dataset.count = count > 0 ? String(count) : '';
  }

  private render(s: TvState): void {
    const playLabel = s.playing ? 'Pause' : 'Play';
    this.playBtn.innerHTML = `${s.playing ? icons.pause : icons.play}<span class="ctl__label">${playLabel}</span>`;
    this.playBtn.setAttribute('aria-label', playLabel);
    this.playBtn.title = `${playLabel} (Space)`;
    const muteLabel = s.muted ? 'Unmute' : 'Mute';
    this.muteBtn.innerHTML = `${s.muted ? icons.muted : icons.volume}<span class="ctl__label">${muteLabel}</span>`;
    this.muteBtn.setAttribute('aria-label', muteLabel);
    this.muteBtn.title = `${muteLabel} (M)`;
    this.muteBtn.classList.toggle('is-active', s.muted);
    this.powerBtn.classList.toggle('is-off', !s.power);
    if (document.activeElement !== this.volume) this.volume.value = String(s.volume);
    this.volumeWrap.style.setProperty('--fill', `${(s.volume / VOLUME_STEPS) * 100}%`);
    this.volumeWrap.classList.toggle('is-muted', s.muted);
    this.root.classList.toggle('is-off', !s.power);
  }
}
