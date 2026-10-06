/**
 * Synthesised TV sounds (no audio files): the "kssh" of static between channels and the thump of
 * a CRT switching on/off. They follow the TV's volume and mute, and stay silent until the page has
 * had a user gesture (AudioContext rules).
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private level = 0.5;
  private audible = false;

  /** Call from inside a user gesture. Safe to call repeatedly. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return;
        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        this.noise = this.makeNoise(this.ctx);
        this.applyGain();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  /** `volume` 0…1 (already curved), `audible` = TV unmuted and allowed to make sound. */
  setOutput(volume: number, audible: boolean): void {
    this.level = volume;
    this.audible = audible;
    this.applyGain();
  }

  staticBurst(ms = 520): void {
    const ctx = this.ready();
    if (!ctx || !this.noise) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.loopStart = Math.random();
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 3200 + Math.random() * 1200;
    band.Q.value = 0.6;
    const g = ctx.createGain();
    const d = ms / 1000;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.03);
    g.gain.setValueAtTime(0.5, t + d * 0.55);
    g.gain.exponentialRampToValueAtTime(0.001, t + d);
    src.connect(band).connect(g).connect(this.master!);
    src.start(t, Math.random() * 1.5);
    src.stop(t + d + 0.05);
  }

  powerOn(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    // low "thoom" of the tube coming up
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(70, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.7, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.75);
    // faint high whine of the flyback transformer
    const whine = ctx.createOscillator();
    whine.frequency.value = 7800;
    const wg = ctx.createGain();
    wg.gain.setValueAtTime(0.0001, t);
    wg.gain.exponentialRampToValueAtTime(0.02, t + 0.15);
    wg.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    whine.connect(wg).connect(this.master!);
    whine.start(t);
    whine.stop(t + 1.2);
    this.staticBurst(380);
  }

  powerOff(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(900, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.22);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.32);
  }

  private ready(): AudioContext | null {
    if (!this.ctx || !this.audible || this.ctx.state !== 'running') return null;
    return this.ctx;
  }

  private applyGain(): void {
    if (!this.master || !this.ctx) return;
    this.master.gain.setTargetAtTime(this.audible ? this.level * 0.3 : 0, this.ctx.currentTime, 0.02);
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }
}
