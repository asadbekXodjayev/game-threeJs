/**
 * Procedural Web Audio — no audio files. Engine note = sawtooth oscillators
 * whose frequency + gain track speed & throttle; wind = filtered noise; rain =
 * brighter filtered noise; a soft lo-fi pad chord for the music bed; honk =
 * two-tone blip; thunder = noise burst. Per-channel toggles. Starts on the
 * first user gesture (browser autoplay policy).
 */

type Channel = 'music' | 'engine' | 'ambience';

export class GameAudio {
  private ctx: AudioContext | null = null;
  private started = false;

  private master!: GainNode;
  private gMusic!: GainNode;
  private gEngine!: GainNode;
  private gAmb!: GainNode;

  // engine
  private oscA!: OscillatorNode;
  private oscB!: OscillatorNode;
  private engGain!: GainNode;
  // wind / rain noise
  private windGain!: GainNode;
  private rainGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  // music
  private padGains: GainNode[] = [];

  private enabled: Record<Channel, boolean> = { music: true, engine: true, ambience: true };

  start(): void {
    if (this.started) return;
    this.started = true;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    const ctx = this.ctx;

    this.master = ctx.createGain(); this.master.gain.value = 0.9; this.master.connect(ctx.destination);
    this.gMusic = ctx.createGain(); this.gMusic.connect(this.master);
    this.gEngine = ctx.createGain(); this.gEngine.connect(this.master);
    this.gAmb = ctx.createGain(); this.gAmb.connect(this.master);

    // ---- engine ----
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0.0; this.engGain.connect(this.gEngine);
    const engFilter = ctx.createBiquadFilter(); engFilter.type = 'lowpass'; engFilter.frequency.value = 900; engFilter.connect(this.engGain);
    this.oscA = ctx.createOscillator(); this.oscA.type = 'sawtooth'; this.oscA.frequency.value = 60;
    this.oscB = ctx.createOscillator(); this.oscB.type = 'square'; this.oscB.frequency.value = 90;
    const oscBGain = ctx.createGain(); oscBGain.gain.value = 0.4;
    this.oscA.connect(engFilter); this.oscB.connect(oscBGain); oscBGain.connect(engFilter);
    this.oscA.start(); this.oscB.start();

    // ---- noise buffer (shared) ----
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    const wind = ctx.createBufferSource(); wind.buffer = noiseBuf; wind.loop = true;
    this.windFilter = ctx.createBiquadFilter(); this.windFilter.type = 'bandpass'; this.windFilter.frequency.value = 500; this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0.05;
    wind.connect(this.windFilter); this.windFilter.connect(this.windGain); this.windGain.connect(this.gAmb); wind.start();

    const rain = ctx.createBufferSource(); rain.buffer = noiseBuf; rain.loop = true;
    const rainFilter = ctx.createBiquadFilter(); rainFilter.type = 'highpass'; rainFilter.frequency.value = 1800;
    this.rainGain = ctx.createGain(); this.rainGain.gain.value = 0.0;
    rain.connect(rainFilter); rainFilter.connect(this.rainGain); this.rainGain.connect(this.gAmb); rain.start();

    // ---- lo-fi music pad: a slow chord ----
    const chord = [220, 277.18, 329.63, 164.81];
    for (const f of chord) {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0.0;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200;
      o.connect(lp); lp.connect(g); g.connect(this.gMusic); o.start();
      this.padGains.push(g);
      // slow swell
      const swell = () => {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        g.gain.cancelScheduledValues(t);
        g.gain.linearRampToValueAtTime(0.06 + Math.random() * 0.05, t + 4);
        g.gain.linearRampToValueAtTime(0.02, t + 9);
        setTimeout(swell, 9000);
      };
      swell();
    }

    this.applyChannels();
    // startup blip
    this.honk(0.4);
  }

  setChannel(ch: Channel, on: boolean): void {
    this.enabled[ch] = on;
    this.applyChannels();
  }

  private applyChannels(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.gMusic.gain.setTargetAtTime(this.enabled.music ? 1 : 0, t, 0.2);
    this.gEngine.gain.setTargetAtTime(this.enabled.engine ? 1 : 0, t, 0.2);
    this.gAmb.gain.setTargetAtTime(this.enabled.ambience ? 1 : 0, t, 0.2);
  }

  /** map speed (0..1 of max) + throttle to engine pitch/gain */
  updateEngine(speed01: number, throttle: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const base = 55 + speed01 * 150;
    this.oscA.frequency.setTargetAtTime(base, t, 0.08);
    this.oscB.frequency.setTargetAtTime(base * 1.5, t, 0.08);
    const g = 0.04 + speed01 * 0.16 + throttle * 0.06;
    this.engGain.gain.setTargetAtTime(g, t, 0.1);
  }

  /** wind grows with speed; rain gain follows weather intensity */
  updateAmbience(speed01: number, rainIntensity: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(0.03 + speed01 * 0.09, t, 0.2);
    this.windFilter.frequency.setTargetAtTime(400 + speed01 * 700, t, 0.2);
    this.rainGain.gain.setTargetAtTime(rainIntensity * 0.16, t, 0.3);
  }

  honk(dur = 0.5): void {
    if (!this.ctx) return;
    const ctx = this.ctx; const t = ctx.currentTime;
    for (const f of [392, 311]) {
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0;
      o.connect(g); g.connect(this.gAmb);
      g.gain.linearRampToValueAtTime(0.18, t + 0.02);
      g.gain.linearRampToValueAtTime(0, t + dur);
      o.start(t); o.stop(t + dur + 0.05);
    }
  }

  thunder(): void {
    if (!this.ctx) return;
    const ctx = this.ctx; const t = ctx.currentTime;
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
    const g = ctx.createGain(); g.gain.value = 0.0;
    src.connect(lp); lp.connect(g); g.connect(this.gAmb);
    g.gain.linearRampToValueAtTime(0.5, t + 0.05);
    g.gain.linearRampToValueAtTime(0, t + 1.2);
    src.start(t);
  }

  resume(): void { this.ctx?.resume(); }
}
