import { channels } from '../../data/channels';
import { h } from '../../shared/dom';
import { icons } from '../../shared/icons';
import { VOLUME_STEPS, formatChannelNumber, type TvState } from '../../shared/protocol';
import type { TvController } from '../tv-controller';

/**
 * Broadcast-style on-screen display: big channel number on tune, a persistent channel bug,
 * classic segmented volume bar, MUTE / PAUSE flags, direct-entry digits, NO SIGNAL, toasts.
 */
export class Osd {
  readonly root: HTMLElement;
  private channelBox = h('div', { class: 'osd-channel', attrs: { 'aria-live': 'polite' } });
  private channelNum = h('div', { class: 'osd-channel__num' });
  private channelName = h('div', { class: 'osd-channel__name' });
  private bug = h('div', { class: 'osd-bug' });
  private flags = h('div', { class: 'osd-flags' });
  private muteFlag = h('div', { class: 'osd-flag osd-flag--mute', html: `${icons.muted}<span>MUTE</span>` });
  private pauseFlag = h('div', { class: 'osd-flag osd-flag--pause', html: `${icons.pause}<span>PAUSE</span>` });
  private remoteFlag = h('div', { class: 'osd-flag osd-flag--remote', html: `${icons.phone}<span>REMOTE</span>` });
  private volume = h('div', { class: 'osd-volume', attrs: { 'aria-hidden': 'true' } });
  private volumeBars: HTMLElement[] = [];
  private volumeValue = h('span', { class: 'osd-volume__value' });
  private noSignal = h('div', { class: 'osd-nosignal', text: 'NO SIGNAL' });
  private standby = h('div', { class: 'osd-standby' }, h('span', { class: 'osd-standby__led' }), 'STANDBY');
  private toasts = h('div', { class: 'osd-toasts', attrs: { 'aria-live': 'polite' } });
  private channelTimer: number | undefined;
  private volumeTimer: number | undefined;
  private remoteTimer: number | undefined;

  constructor(private readonly tv: TvController) {
    this.channelBox.append(this.channelNum, this.channelName);
    this.flags.append(this.remoteFlag, this.muteFlag, this.pauseFlag);
    const bars = h('div', { class: 'osd-volume__bars' });
    for (let i = 0; i < VOLUME_STEPS; i++) {
      const bar = h('i');
      this.volumeBars.push(bar);
      bars.append(bar);
    }
    this.volume.append(h('span', { class: 'osd-volume__label', text: 'VOLUME' }), bars, this.volumeValue);
    this.root = h(
      'div',
      { class: 'osd' },
      this.channelBox,
      this.bug,
      this.flags,
      this.volume,
      this.noSignal,
      this.standby,
      this.toasts,
    );

    tv.on('tuneStart', ({ index }) => this.showChannel(index));
    tv.on('volume', ({ level, muted }) => this.showVolume(level, muted));
    tv.on('change', (state) => this.render(state));
    tv.on('remoteCommand', () => this.flashRemote());
    this.render(tv.state);
    this.showChannel(tv.state.channel);
  }

  toast(message: string, tone: 'info' | 'good' | 'warn' = 'info', ms = 3200): void {
    const el = h('div', { class: `osd-toast osd-toast--${tone}`, text: message });
    this.toasts.append(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
    window.setTimeout(() => {
      el.classList.remove('is-in');
      window.setTimeout(() => el.remove(), 400);
    }, ms);
  }

  private showChannel(index: number): void {
    const c = channels[index];
    this.channelNum.textContent = `CH ${formatChannelNumber(c.number)}`;
    this.channelName.textContent = c.client.toUpperCase();
    this.channelBox.classList.remove('is-entry');
    this.channelBox.classList.add('is-visible');
    this.bug.classList.remove('is-visible');
    window.clearTimeout(this.channelTimer);
    this.channelTimer = window.setTimeout(() => {
      this.channelBox.classList.remove('is-visible');
      this.bug.classList.add('is-visible');
    }, 3800);
  }

  private showVolume(level: number, muted: boolean): void {
    this.volumeBars.forEach((bar, i) => bar.classList.toggle('is-on', i < level));
    this.volumeValue.textContent = muted ? 'MUTE' : String(level).padStart(2, '0');
    this.volume.classList.toggle('is-muted', muted);
    this.volume.classList.add('is-visible');
    window.clearTimeout(this.volumeTimer);
    this.volumeTimer = window.setTimeout(() => this.volume.classList.remove('is-visible'), 2200);
  }

  private flashRemote(): void {
    this.remoteFlag.classList.add('is-visible', 'is-blink');
    window.setTimeout(() => this.remoteFlag.classList.remove('is-blink'), 140);
    window.clearTimeout(this.remoteTimer);
    this.remoteTimer = window.setTimeout(() => this.remoteFlag.classList.remove('is-visible'), 1600);
  }

  private render(state: TvState): void {
    const c = channels[state.channel];
    this.bug.textContent = formatChannelNumber(c.number);
    if (state.entry) {
      this.channelNum.textContent = `CH ${state.entry}`;
      this.channelName.textContent = '';
      this.channelBox.classList.add('is-visible', 'is-entry');
      this.bug.classList.remove('is-visible');
      window.clearTimeout(this.channelTimer);
      this.channelTimer = window.setTimeout(() => {
        this.channelBox.classList.remove('is-visible', 'is-entry');
        this.bug.classList.add('is-visible');
      }, 2600);
    }
    this.muteFlag.classList.toggle('is-visible', state.power && state.muted && !this.firstMute(state));
    this.pauseFlag.classList.toggle('is-visible', state.power && !state.playing && !state.tuning);
    this.noSignal.classList.toggle('is-visible', state.power && !state.tuning && this.tv.channelFailed());
    this.standby.classList.toggle('is-visible', !state.power);
    this.root.classList.toggle('is-off', !state.power);
  }

  /** While the "click for sound" prompt is up, the MUTE flag would just repeat it. */
  private firstMute(state: TvState): boolean {
    return state.muted && !this.tv.everUnmuted;
  }
}
