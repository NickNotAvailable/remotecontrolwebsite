import { channels, type Channel } from '../../data/channels';
import { h } from '../../shared/dom';
import { formatChannelNumber } from '../../shared/protocol';
import type { TvController } from '../tv-controller';

/**
 * Project graphics. On the TV layout: a broadcast lower-third that re-types itself after every
 * channel change and expands with credits on INFO. On the portable layout: the "Now playing" card.
 */
export class LowerThird {
  readonly root: HTMLElement;
  private tag = h('span', { class: 'lt__tag' });
  private client = h('h2', { class: 'lt__client' });
  private title = h('p', { class: 'lt__title' });
  private meta = h('p', { class: 'lt__meta' });
  private details = h('div', { class: 'lt__details' });
  private description = h('p', { class: 'lt__desc' });
  private credits = h('dl', { class: 'lt__credits' });
  private infoTimer: number | undefined;
  private freshTimer: number | undefined;

  constructor(tv: TvController) {
    this.details.append(h('div', { class: 'lt__details-inner' }, this.description, this.credits));
    this.root = h(
      'section',
      { class: 'lt', attrs: { 'aria-live': 'polite', 'aria-label': 'Now playing' } },
      h('div', { class: 'lt__row' }, this.tag, h('span', { class: 'lt__onair', text: 'ON AIR' })),
      this.client,
      this.title,
      this.meta,
      this.details,
    );
    tv.on('tuneStart', () => this.root.classList.add('is-tuning'));
    tv.on('tuneReveal', ({ index }) => this.reveal(channels[index]));
    tv.on('info', () => this.showInfo());
    tv.on('power', (on) => {
      this.root.classList.toggle('is-off', !on);
      // stay hidden through the warm-up; `tuneReveal` brings the graphics back
      if (on) this.root.classList.add('is-tuning');
    });
    this.fill(channels[tv.state.channel]);
    requestAnimationFrame(() => this.reveal(channels[tv.state.channel]));
  }

  showInfo(ms = 9000): void {
    this.root.classList.add('is-info');
    window.clearTimeout(this.infoTimer);
    this.infoTimer = window.setTimeout(() => this.root.classList.remove('is-info'), ms);
  }

  get infoOpen(): boolean {
    return this.root.classList.contains('is-info');
  }

  hideInfo(): void {
    window.clearTimeout(this.infoTimer);
    this.root.classList.remove('is-info');
  }

  private reveal(c: Channel): void {
    this.fill(c);
    this.root.classList.remove('is-revealed');
    void this.root.offsetWidth; // restart the CSS reveal animation
    this.root.classList.remove('is-tuning');
    this.root.classList.add('is-revealed', 'is-fresh');
    // stay up for a few seconds after every channel change, then get out of the picture's way
    window.clearTimeout(this.freshTimer);
    this.freshTimer = window.setTimeout(() => this.root.classList.remove('is-fresh'), 6500);
  }

  private fill(c: Channel): void {
    this.root.style.setProperty('--accent', c.accent);
    this.tag.textContent = `CH ${formatChannelNumber(c.number)}`;
    this.client.textContent = c.client;
    this.title.textContent = c.title;
    this.meta.textContent = [c.category, c.year, c.role, c.runtime].join('  ·  ');
    this.description.textContent = c.description;
    this.credits.replaceChildren(
      ...c.credits.flatMap((cr) => [h('dt', { text: cr.label }), h('dd', { text: cr.value })]),
    );
  }
}
