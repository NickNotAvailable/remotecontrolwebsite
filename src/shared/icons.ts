/** Inline SVG icons (24×24, stroke = currentColor). */
const svg = (body: string, extra = '') =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;

export const icons = {
  power: svg('<path d="M12 3v8"/><path d="M6.3 6.6a8 8 0 1 0 11.4 0"/>'),
  prev: svg('<path d="M15 6l-6 6 6 6"/>'),
  next: svg('<path d="M9 6l6 6-6 6"/>'),
  up: svg('<path d="M6 15l6-6 6 6"/>'),
  down: svg('<path d="M6 9l6 6 6-6"/>'),
  play: svg('<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>'),
  pause: svg('<rect x="6.5" y="5.5" width="4" height="13" rx="1" fill="currentColor" stroke="none"/><rect x="13.5" y="5.5" width="4" height="13" rx="1" fill="currentColor" stroke="none"/>'),
  volume: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke="none"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
  muted: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke="none"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>'),
  guide: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9h17M9 9v10.5"/>'),
  phone: svg('<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>'),
  fullscreen: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  info: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6v.4"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  refresh: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
};
