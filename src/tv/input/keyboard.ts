import type { TvController } from '../tv-controller';

export interface KeyboardHooks {
  guide: { handleKey(e: KeyboardEvent): boolean; toggle(): void; isOpen: boolean };
  toggleRemotePanel(): void;
  toggleFullscreen(): void;
  closeOverlays(): boolean;
  wake(): void;
}

/**
 *  ↑ / → / PageUp     next channel        0–9     direct entry ("1-", then "12")
 *  ↓ / ← / PageDown   previous channel    + / −   volume
 *  M                  mute                Space/K play / pause
 *  G                  guide               I       info
 *  R                  phone remote        P       power
 *  F                  full screen         Esc     close overlays
 */
export function bindKeyboard(tv: TvController, hooks: KeyboardHooks): void {
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) {
      const isRange = target instanceof HTMLInputElement && target.type === 'range';
      // a focused volume slider keeps its native arrow keys; other shortcuts still work
      if (!isRange || /^(Arrow|Page|Home|End)/.test(e.key)) return;
    }
    // Like a real TV, channel/volume keys only show the OSD; Tab reveals the on-screen controls.
    if (e.key === 'Tab') hooks.wake();
    if (hooks.guide.handleKey(e)) {
      e.preventDefault();
      return;
    }
    let handled = true;
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowRight':
      case 'PageUp':
        tv.step(1);
        break;
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'PageDown':
        tv.step(-1);
        break;
      case '+':
      case '=':
        tv.stepVolume(1);
        break;
      case '-':
      case '_':
        tv.stepVolume(-1);
        break;
      case 'm':
      case 'M':
        tv.toggleMute();
        break;
      case ' ':
      case 'k':
      case 'K':
        // let Space activate a focused button normally
        if (target instanceof HTMLButtonElement && e.key === ' ') return;
        tv.togglePlay();
        break;
      case 'g':
      case 'G':
        hooks.guide.toggle();
        break;
      case 'i':
      case 'I':
        tv.showInfo();
        break;
      case 'r':
      case 'R':
        hooks.toggleRemotePanel();
        break;
      case 'p':
      case 'P':
        tv.togglePower();
        break;
      case 'f':
      case 'F':
        hooks.toggleFullscreen();
        break;
      case 'Escape':
        handled = hooks.closeOverlays();
        break;
      default:
        if (/^[0-9]$/.test(e.key)) tv.digit(Number(e.key));
        else handled = false;
    }
    if (handled) e.preventDefault();
  });
}
