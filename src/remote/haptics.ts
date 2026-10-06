/**
 * Haptic feedback for remote buttons.
 *  - Android / Chrome: Vibration API.
 *  - iOS Safari 18+: no Vibration API, but toggling an `<input type="checkbox" switch>` produces a
 *    system haptic tick. We keep an invisible one around and click its label during the gesture.
 *  - Everything else: silently nothing (the visual press animation still sells it).
 */
type Kind = 'tap' | 'heavy' | 'error';

const PATTERNS: Record<Kind, number | number[]> = {
  tap: 8,
  heavy: 16,
  error: [12, 50, 12],
};

let iosLabel: HTMLLabelElement | null = null;
const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function iosTick(): void {
  if (!iosLabel) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.id = 'haptic-switch';
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');
    iosLabel = document.createElement('label');
    iosLabel.htmlFor = input.id;
    iosLabel.setAttribute('aria-hidden', 'true');
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
    box.append(input, iosLabel);
    document.body.append(box);
  }
  iosLabel.click();
}

export function haptic(kind: Kind = 'tap'): void {
  try {
    if (canVibrate) navigator.vibrate(PATTERNS[kind]);
    else if (isIOS) {
      iosTick();
      if (kind === 'error') window.setTimeout(iosTick, 70);
    }
  } catch {
    /* never let feedback break a button */
  }
}
