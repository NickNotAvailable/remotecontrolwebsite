/** Horizontal swipe on the screen = channel change (portable layout / tablets). */
export function bindSwipe(el: HTMLElement, onSwipe: (direction: 1 | -1) => void): void {
  let x0 = 0;
  let y0 = 0;
  let t0 = 0;
  let tracking = false;
  el.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1) return;
      tracking = true;
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
      t0 = performance.now();
    },
    { passive: true },
  );
  el.addEventListener(
    'touchend',
    (e) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - x0;
      const dy = t.clientY - y0;
      const dt = performance.now() - t0;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4 && dt < 700) {
        onSwipe(dx < 0 ? 1 : -1);
      }
    },
    { passive: true },
  );
}
