import { h } from '../../shared/dom';
import { icons } from '../../shared/icons';
import type { TvState } from '../../shared/protocol';
import type { TvController } from '../tv-controller';

/**
 * Browsers only allow sound after someone interacts with the page. Rather than a modal, the TV
 * shows a small broadcast-style prompt; any click on the screen turns the sound on.
 * If a phone asks for sound before that has happened, the prompt becomes more insistent.
 */
export class SoundPrompt {
  readonly root: HTMLElement;
  private text = h('span', { class: 'sound-prompt__text' });

  constructor(
    private readonly tv: TvController,
    private readonly touch: boolean,
  ) {
    this.root = h(
      'button',
      {
        class: 'sound-prompt',
        attrs: { type: 'button' },
        on: {
          click: (e) => {
            e.stopPropagation();
            tv.setMuted(false);
          },
        },
      },
      h('span', { class: 'sound-prompt__icon', html: icons.muted }),
      this.text,
    );
    tv.on('change', (s) => this.render(s));
    this.render(tv.state);
  }

  private render(s: TvState): void {
    const firstRun = s.muted && !this.tv.everUnmuted;
    const visible = s.power && (s.soundBlocked || firstRun);
    this.root.classList.toggle('is-visible', visible);
    this.root.classList.toggle('is-urgent', s.soundBlocked);
    const verb = this.touch ? 'Tap' : 'Click';
    this.text.innerHTML = s.soundBlocked
      ? `<b>${verb} the screen to allow sound</b><small>Your browser needs one ${verb.toLowerCase()} on this page first</small>`
      : `<b>${this.touch ? 'Tap for sound' : 'Sound is off'}</b><small>${verb} anywhere to tune in with sound</small>`;
    this.root.setAttribute('aria-hidden', String(!visible));
    this.root.tabIndex = visible ? 0 : -1;
  }
}
