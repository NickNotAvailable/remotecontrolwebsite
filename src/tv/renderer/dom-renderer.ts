import type { FitMode, Renderer, RendererOptions } from './types';

/**
 * Fallback when WebGL is unavailable (or a cross-origin video can't be sampled): the <video>
 * element is shown directly, and the analog effects are approximated with CSS transforms/filters
 * plus a low-res canvas of animated snow.
 */
export class DomRenderer implements Renderer {
  readonly kind = 'dom' as const;
  private source: HTMLVideoElement | null = null;
  private raf = 0;
  private dead = false;
  private noise: HTMLCanvasElement;
  private noiseCtx: CanvasRenderingContext2D | null;
  private noiseImage: ImageData | null = null;
  private glow: HTMLDivElement;
  private frame = 0;

  constructor(private readonly opts: RendererOptions) {
    opts.screen.classList.add('screen--dom');
    this.noise = document.createElement('canvas');
    this.noise.className = 'screen__snow';
    this.noise.width = 192;
    this.noise.height = 108;
    this.noiseCtx = this.noise.getContext('2d');
    this.glow = document.createElement('div');
    this.glow.className = 'screen__glow';
    opts.canvas.after(this.noise, this.glow);
  }

  setSource(video: HTMLVideoElement | null): void {
    if (this.source === video) return;
    if (this.source) {
      this.source.classList.remove('is-on-air');
      this.source.style.transform = '';
      this.source.style.filter = '';
    }
    this.source = video;
    video?.classList.add('is-on-air');
  }

  setFit(mode: FitMode): void {
    this.opts.screen.dataset.fit = mode;
  }

  start(): void {
    const loop = (now: number) => {
      if (this.dead) return;
      this.raf = requestAnimationFrame(loop);
      this.draw(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy(): void {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    this.noise.remove();
    this.glow.remove();
    this.opts.screen.classList.remove('screen--dom');
  }

  private draw(now: number): void {
    const p = this.opts.fx.update(now);
    const v = this.source;
    if (v) {
      const jitter = p.glitch ? (Math.random() - 0.5) * 40 * p.glitch : 0;
      const roll = p.roll * 100;
      v.style.transform =
        `translate3d(${jitter.toFixed(1)}px, ${roll.toFixed(2)}%, 0) ` +
        `scale(${Math.max(p.powerX, 0.002)}, ${Math.max(p.powerY, 0.002)}) skewX(${(p.glitch * 4 * Math.sin(now / 37)).toFixed(2)}deg)`;
      v.style.filter = `brightness(${(p.bright * (1 + p.glow * 3)).toFixed(3)}) contrast(${(1 + p.glitch * 0.4).toFixed(2)})`;
    }
    this.glow.style.opacity = String(p.dot * 0.9);

    const amount = Math.min(1, p.noise + p.tracking * 0.25);
    this.noise.style.opacity = amount.toFixed(3);
    if (amount > 0.01 && this.noiseCtx && (this.frame++ & 1) === 0) {
      const ctx = this.noiseCtx;
      if (!this.noiseImage) this.noiseImage = ctx.createImageData(this.noise.width, this.noise.height);
      const data = this.noiseImage.data;
      for (let i = 0; i < data.length; i += 4) {
        const n = (Math.random() * 255) | 0;
        data[i] = data[i + 1] = data[i + 2] = n;
        data[i + 3] = 255;
      }
      ctx.putImageData(this.noiseImage, 0, 0);
    }
  }
}
