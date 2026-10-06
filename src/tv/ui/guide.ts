import { channels } from '../../data/channels';
import { site } from '../../data/site';
import { h } from '../../shared/dom';
import { icons } from '../../shared/icons';
import { formatChannelNumber, type TvState } from '../../shared/protocol';
import type { TvController } from '../tv-controller';

/**
 * Programme guide (EPG): every channel at a glance, plus the director's details.
 * TV layout: full-screen overlay. Portable layout: rendered inline below the screen.
 */
export class Guide {
  readonly root: HTMLElement;
  readonly about: HTMLElement;
  private rows: HTMLButtonElement[] = [];
  private clock = h('span', { class: 'guide__clock' });
  private clockTimer: number | undefined;
  private selected = 0;
  private inline = false;
  private returnFocus: HTMLElement | null = null;
  isOpen = false;
  onClose?: () => void;

  constructor(private readonly tv: TvController) {
    const list = h('ol', { class: 'guide__list', attrs: { role: 'list' } });
    channels.forEach((c, i) => {
      const row = h(
        'button',
        {
          class: 'guide__row',
          attrs: { type: 'button', 'data-channel': c.number },
          style: { '--accent': c.accent } as Record<string, string>,
          on: {
            click: (e) => {
              e.stopPropagation();
              tv.tuneTo(i);
              this.close();
            },
            mouseenter: () => this.select(i, false),
          },
        },
        h('span', { class: 'guide__num', text: formatChannelNumber(c.number) }),
        h('img', { class: 'guide__thumb', attrs: { src: c.poster, alt: '', loading: 'lazy', decoding: 'async' } }),
        h(
          'span',
          { class: 'guide__text' },
          h('span', { class: 'guide__client', text: c.client }),
          h('span', { class: 'guide__title', text: c.title }),
        ),
        h('span', { class: 'guide__cat', text: c.category }),
        h('span', { class: 'guide__year', text: String(c.year) }),
        h('span', { class: 'guide__now', text: 'ON NOW' }),
      );
      this.rows.push(row);
      list.append(h('li', {}, row));
    });

    this.about = h(
      'aside',
      { class: 'about' },
      h('p', { class: 'about__eyebrow', text: site.role }),
      h('h2', { class: 'about__name', text: site.name }),
      h('p', { class: 'about__bio', text: site.bio }),
      h('p', { class: 'about__rep', text: site.representation }),
      h('a', { class: 'about__email', attrs: { href: `mailto:${site.email}` }, text: site.email }),
      h(
        'p',
        { class: 'about__links' },
        ...site.links.map((l) => h('a', { attrs: { href: l.href, target: '_blank', rel: 'noopener' }, text: l.label })),
      ),
    );

    const keys = h(
      'p',
      { class: 'guide__keys' },
      ...[
        ['↑ ↓', 'channel'],
        ['0–9', 'tune'],
        ['+ −', 'volume'],
        ['M', 'mute'],
        ['Space', 'pause'],
        ['I', 'info'],
        ['P', 'power'],
        ['R', 'remote'],
        ['F', 'full screen'],
      ].map(([k, v]) => h('span', {}, h('kbd', { text: k }), ` ${v}`)),
    );

    this.root = h(
      'div',
      { class: 'guide', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Channel guide', 'aria-hidden': 'true' } },
      h(
        'div',
        { class: 'guide__panel' },
        h(
          'header',
          { class: 'guide__head' },
          h('span', { class: 'guide__label', text: 'GUIDE' }),
          h('span', { class: 'guide__station', text: `${site.ident} · ${site.identSub}` }),
          this.clock,
          h('button', {
            class: 'guide__close',
            attrs: { type: 'button', 'aria-label': 'Close guide' },
            html: icons.close,
            on: { click: (e) => (e.stopPropagation(), this.close()) },
          }),
        ),
        h('div', { class: 'guide__body' }, list, this.about),
        keys,
      ),
    );
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close();
      e.stopPropagation();
    });
    tv.on('change', (s) => this.render(s));
    this.render(tv.state);
  }

  /** Portable layout: the guide is part of the page instead of an overlay. */
  setInline(inline: boolean): void {
    if (this.inline === inline) return;
    if (this.isOpen) this.close();
    this.inline = inline;
    this.root.classList.toggle('guide--inline', inline);
    if (inline) {
      this.root.removeAttribute('role');
      this.root.removeAttribute('aria-modal');
      this.root.setAttribute('aria-hidden', 'false');
    } else {
      this.root.setAttribute('role', 'dialog');
      this.root.setAttribute('aria-modal', 'true');
      this.root.setAttribute('aria-hidden', 'true');
    }
  }

  open(): void {
    if (this.inline) return;
    if (this.isOpen) return;
    this.isOpen = true;
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.root.classList.add('is-open');
    this.root.setAttribute('aria-hidden', 'false');
    this.select(this.tv.state.channel, true);
    this.tickClock();
  }

  close(): void {
    if (this.inline || !this.isOpen) return;
    this.isOpen = false;
    this.root.classList.remove('is-open');
    this.root.setAttribute('aria-hidden', 'true');
    window.clearTimeout(this.clockTimer);
    if (this.root.contains(document.activeElement)) this.returnFocus?.focus({ preventScroll: true });
    this.returnFocus = null;
    this.onClose?.();
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** Keyboard navigation while open. Returns true if the key was handled. */
  handleKey(e: KeyboardEvent): boolean {
    if (!this.isOpen) return false;
    switch (e.key) {
      case 'ArrowDown':
        this.select(Math.min(this.rows.length - 1, this.selected + 1), true);
        return true;
      case 'ArrowUp':
        this.select(Math.max(0, this.selected - 1), true);
        return true;
      case 'Enter':
        this.tv.tuneTo(this.selected);
        this.close();
        return true;
      case 'Escape':
      case 'g':
      case 'G':
        this.close();
        return true;
    }
    return false;
  }

  private select(i: number, focus: boolean): void {
    this.selected = i;
    this.rows.forEach((r, j) => r.classList.toggle('is-selected', j === i));
    if (focus) this.rows[i]?.focus({ preventScroll: false });
  }

  private tickClock(): void {
    const now = new Date();
    this.clock.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    this.clockTimer = window.setTimeout(() => this.tickClock(), 15_000);
  }

  private render(s: TvState): void {
    this.rows.forEach((r, i) => r.classList.toggle('is-current', i === s.channel));
  }
}
