import { FRAGMENT, VERTEX } from './shaders';
import type { FitMode, Renderer, RendererOptions } from './types';

const MAX_PIXELS = 2_600_000; // ~2200×1200; plenty for scanlines, kind to integrated GPUs

const UNIFORMS = [
  'uTex', 'uScale', 'uHasTex', 'uRes', 'uDpr', 'uTime', 'uSeed',
  'uNoise', 'uGlitch', 'uRgb', 'uRoll', 'uBright', 'uPowerY', 'uPowerX', 'uGlow', 'uDot', 'uTracking',
  'uScan', 'uGrain', 'uVignette', 'uCurve', 'uAberration',
] as const;
type UniformName = (typeof UNIFORMS)[number];

type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export class WebGLRenderer implements Renderer {
  readonly kind = 'webgl' as const;
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private u = {} as Record<UniformName, WebGLUniformLocation | null>;
  private texture: WebGLTexture;
  private source: FrameCallbackVideo | null = null;
  private frameDirty = true;
  private frameHandle = 0;
  private hasFrame = false;
  private fit: FitMode = 'cover';
  private raf = 0;
  private dpr = 1;
  private seed = Math.random() * 100;
  private resizeObserver: ResizeObserver;
  private dead = false;

  /** Throws if WebGL is unavailable; the caller falls back to the DOM renderer. */
  constructor(private readonly opts: RendererOptions) {
    const gl = opts.canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;
    this.program = this.createProgram(VERTEX, FRAGMENT);
    gl.useProgram(this.program);
    for (const name of UNIFORMS) this.u[name] = gl.getUniformLocation(this.program, name);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(this.program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    this.texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.uniform1i(this.u.uTex, 0);

    opts.canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(opts.screen);
    this.resize();
    opts.screen.classList.add('screen--webgl');
  }

  setSource(video: HTMLVideoElement | null): void {
    if (this.source === video) return;
    if (this.source && this.frameHandle && this.source.cancelVideoFrameCallback) {
      this.source.cancelVideoFrameCallback(this.frameHandle);
    }
    this.source = video as FrameCallbackVideo | null;
    this.hasFrame = false;
    this.frameDirty = true;
    this.watchFrames();
  }

  setFit(mode: FitMode): void {
    this.fit = mode;
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
    this.resizeObserver.disconnect();
    this.opts.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.opts.screen.classList.remove('screen--webgl');
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  /* ------------------------------------------------------------------------------------- */

  private watchFrames(): void {
    const v = this.source;
    if (!v?.requestVideoFrameCallback) return;
    const onFrame = () => {
      if (this.source !== v) return;
      this.frameDirty = true;
      this.frameHandle = v.requestVideoFrameCallback!(onFrame);
    };
    this.frameHandle = v.requestVideoFrameCallback(onFrame);
  }

  private resize(): void {
    const rect = this.opts.screen.getBoundingClientRect();
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixels = rect.width * rect.height * dpr * dpr;
    if (pixels > MAX_PIXELS) dpr *= Math.sqrt(MAX_PIXELS / pixels);
    this.dpr = dpr;
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (this.opts.canvas.width !== w || this.opts.canvas.height !== h) {
      this.opts.canvas.width = w;
      this.opts.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
  }

  private upload(): void {
    const v = this.source;
    if (!v || v.readyState < 2 || v.videoWidth === 0) return;
    // Without requestVideoFrameCallback we can't know if a new frame arrived; upload while playing.
    const needsUpload = !this.hasFrame || this.frameDirty || (!v.requestVideoFrameCallback && !v.paused);
    if (!needsUpload) return;
    const gl = this.gl;
    try {
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, v);
      this.hasFrame = true;
      this.frameDirty = false;
    } catch (err) {
      // SecurityError: cross-origin video without CORS headers.
      console.warn('[webgl] cannot sample video, falling back to DOM renderer', err);
      this.fatal('tainted');
    }
  }

  private draw(now: number): void {
    const { fx, canvas } = this.opts;
    const p = fx.update(now);
    const look = fx.look;
    const gl = this.gl;
    this.upload();

    let sx = 1;
    let sy = 1;
    const v = this.source;
    if (v && v.videoWidth) {
      const screenAspect = canvas.width / canvas.height;
      const videoAspect = v.videoWidth / v.videoHeight;
      const cover = this.fit === 'cover';
      if (screenAspect > videoAspect) {
        // screen is wider than the video
        if (cover) sy = videoAspect / screenAspect;
        else sx = screenAspect / videoAspect;
      } else if (cover) {
        sx = screenAspect / videoAspect;
      } else {
        sy = videoAspect / screenAspect;
      }
    }

    const u = this.u;
    gl.uniform2f(u.uScale, sx, sy);
    gl.uniform1f(u.uHasTex, this.hasFrame ? 1 : 0);
    gl.uniform2f(u.uRes, canvas.width, canvas.height);
    gl.uniform1f(u.uDpr, this.dpr);
    gl.uniform1f(u.uTime, (now / 1000) % 1000);
    gl.uniform1f(u.uSeed, this.seed);
    gl.uniform1f(u.uNoise, p.noise);
    gl.uniform1f(u.uGlitch, p.glitch);
    gl.uniform1f(u.uRgb, p.rgb);
    gl.uniform1f(u.uRoll, p.roll);
    gl.uniform1f(u.uBright, p.bright);
    gl.uniform1f(u.uPowerY, p.powerY);
    gl.uniform1f(u.uPowerX, p.powerX);
    gl.uniform1f(u.uGlow, p.glow);
    gl.uniform1f(u.uDot, p.dot);
    gl.uniform1f(u.uTracking, p.tracking);
    gl.uniform1f(u.uScan, look.scanlines);
    gl.uniform1f(u.uGrain, look.grain);
    gl.uniform1f(u.uVignette, look.vignette);
    gl.uniform1f(u.uCurve, look.curvature);
    gl.uniform1f(u.uAberration, look.aberration);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private onContextLost = (e: Event) => {
    e.preventDefault();
    this.fatal('context-lost');
  };

  private fatal(reason: string): void {
    if (this.dead) return;
    this.destroy();
    this.opts.onFatal?.(reason);
  }

  private createProgram(vsSource: string, fsSource: string): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(shader)}`);
      }
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vsSource));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fsSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Program link failed: ${gl.getProgramInfoLog(program)}`);
    }
    return program;
  }
}
