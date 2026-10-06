import { renderSVG } from 'uqr';
import { h } from '../../shared/dom';
import { icons } from '../../shared/icons';
import type { PeerInfo } from '../../shared/protocol';
import type { TvPairing } from '../pairing';

/**
 * The "scan me" corner sticker (like the QR codes broadcasters put in the corner of the screen),
 * the expanded pairing card, and the linked-status pill once a phone is connected.
 */
export class PairingPanel {
  readonly root: HTMLElement;
  private miniQr = h('div', { class: 'pair__qr pair__qr--mini' });
  private bigQr = h('div', { class: 'pair__qr pair__qr--big' });
  private code = h('span', { class: 'pair__code-value' });
  private host = h('b', { class: 'pair__host' });
  private status = h('p', { class: 'pair__status' });
  private note = h('p', { class: 'pair__note' });
  private linkedText = h('span', { class: 'pair__linked-text' });
  private remoteList = h('ul', { class: 'pair__remotes' });
  private expanded = false;
  onExpandChange?: (expanded: boolean) => void;

  constructor(private readonly pairing: TvPairing) {
    const sticker = h(
      'button',
      {
        class: 'pair__sticker',
        attrs: { type: 'button', 'aria-label': 'Use your phone as the remote — show the pairing code' },
        on: { click: (e) => (e.stopPropagation(), this.toggle()) },
      },
      this.miniQr,
      h(
        'span',
        { class: 'pair__sticker-text' },
        h('b', { text: 'Scan for the remote' }),
        h('span', { text: 'Your phone controls this TV. No app.' }),
      ),
    );

    const card = h(
      'div',
      { class: 'pair__card', attrs: { role: 'dialog', 'aria-label': 'Pair your phone' } },
      h(
        'header',
        { class: 'pair__head' },
        h('span', { class: 'pair__eyebrow', text: 'PHONE REMOTE' }),
        h('button', {
          class: 'pair__close',
          attrs: { type: 'button', 'aria-label': 'Close' },
          html: icons.close,
          on: { click: (e) => (e.stopPropagation(), this.setExpanded(false)) },
        }),
      ),
      this.bigQr,
      h(
        'ol',
        { class: 'pair__steps' },
        h('li', { text: 'Point your phone’s camera at the code.' }),
        h('li', { text: 'Open the link — it becomes the remote for this screen.' }),
      ),
      h('p', { class: 'pair__code' }, 'Or visit ', this.host, ' and enter ', this.code),
      this.note,
      this.status,
      this.remoteList,
      h(
        'button',
        {
          class: 'pair__new',
          attrs: { type: 'button' },
          on: { click: (e) => (e.stopPropagation(), this.pairing.newCode()) },
        },
        h('span', { html: icons.refresh }),
        'New code · disconnect phones',
      ),
    );

    const linked = h(
      'button',
      {
        class: 'pair__linked',
        attrs: { type: 'button', 'aria-label': 'Remote connected — show details' },
        on: { click: (e) => (e.stopPropagation(), this.toggle()) },
      },
      h('span', { class: 'pair__dot' }),
      this.linkedText,
    );

    this.root = h('aside', { class: 'pair', attrs: { 'aria-label': 'Phone remote' } }, sticker, card, linked);
    this.root.addEventListener('click', (e) => e.stopPropagation());

    pairing.on('session', () => this.renderCode());
    pairing.on('status', () => this.renderStatus());
    pairing.on('remotes', () => this.renderStatus());
    this.renderCode();
    this.renderStatus();
  }

  get isExpanded(): boolean {
    return this.expanded;
  }

  toggle(): void {
    this.setExpanded(!this.expanded);
  }

  setExpanded(expanded: boolean): void {
    if (this.expanded === expanded) return;
    this.expanded = expanded;
    this.root.classList.toggle('is-expanded', expanded);
    this.onExpandChange?.(expanded);
  }

  private renderCode(): void {
    const url = this.pairing.pairUrl();
    const svg = (dark: string, light: string) =>
      renderSVG(url, { ecc: 'M', border: 2, pixelSize: 8, blackColor: dark, whiteColor: light });
    this.miniQr.innerHTML = svg('#0b0c0e', '#f4f1e8');
    this.bigQr.innerHTML = svg('#0b0c0e', '#f4f1e8');
    this.bigQr.dataset.url = url;
    this.root.dataset.session = this.pairing.session;
    this.root.dataset.pairUrl = url;
    const s = this.pairing.session;
    this.code.textContent = `${s.slice(0, 3)} ${s.slice(3)}`;
    this.host.textContent = `${this.pairing.base.replace(/^https?:\/\//, '')}/remote`;
    this.note.textContent = this.pairing.note ?? '';
    this.note.hidden = !this.pairing.note;
  }

  private renderStatus(): void {
    const status = this.pairing.status;
    const remotes = this.pairing.remotes;
    const linked = status === 'online' && remotes.length > 0;
    this.root.classList.toggle('is-linked', linked);
    this.root.classList.toggle('is-offline', status !== 'online');
    this.root.dataset.status = status;
    this.root.dataset.remotes = String(remotes.length);
    if (status !== 'online') {
      this.status.textContent = status === 'closed' ? 'Pairing unavailable.' : 'Connecting to the pairing service…';
    } else if (!remotes.length) {
      this.status.textContent = 'Waiting for a phone…';
    } else {
      this.status.textContent = remotes.length === 1 ? '1 remote connected' : `${remotes.length} remotes connected`;
    }
    this.remoteList.replaceChildren(...remotes.map((r: PeerInfo) => h('li', {}, h('span', { class: 'pair__dot' }), r.label || 'Phone')));
    this.linkedText.textContent =
      remotes.length > 1 ? `${remotes.length} REMOTES LINKED` : `REMOTE LINKED · ${remotes[0]?.label?.split(' · ').pop() ?? ''}`;
  }
}
