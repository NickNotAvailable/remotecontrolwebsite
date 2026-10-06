import type { Fx } from '../fx';

export type FitMode = 'cover' | 'contain';

export interface Renderer {
  readonly kind: 'webgl' | 'dom';
  /** The video currently drawn (null = nothing / no signal). */
  setSource(video: HTMLVideoElement | null): void;
  setFit(mode: FitMode): void;
  start(): void;
  destroy(): void;
}

export interface RendererOptions {
  screen: HTMLElement;
  canvas: HTMLCanvasElement;
  fx: Fx;
  /** Called when WebGL can't continue (context lost, tainted cross-origin video). */
  onFatal?: (reason: string) => void;
}
