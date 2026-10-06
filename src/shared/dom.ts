type Child = Node | string | number | null | undefined | false;

interface Props {
  class?: string;
  attrs?: Record<string, string | number | boolean | undefined>;
  dataset?: Record<string, string>;
  style?: Partial<CSSStyleDeclaration> | Record<string, string>;
  html?: string;
  text?: string;
  on?: { [K in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[K]) => void };
}

/** Tiny hyperscript helper: `h('button', { class: 'btn', on: { click } }, 'Label')`. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.attrs) {
    for (const [k, v] of Object.entries(props.attrs)) {
      if (v === undefined || v === false) continue;
      el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  if (props.dataset) Object.assign(el.dataset, props.dataset);
  if (props.style) {
    for (const [k, v] of Object.entries(props.style)) {
      if (k.startsWith('--')) el.style.setProperty(k, String(v));
      else (el.style as unknown as Record<string, string>)[k] = String(v);
    }
  }
  if (props.html !== undefined) el.innerHTML = props.html;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.on) {
    for (const [k, fn] of Object.entries(props.on)) el.addEventListener(k, fn as EventListener);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
