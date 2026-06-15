import * as THREE from 'three';
import { BIOMES, BIOME_SECONDS, TRANSITION_SECONDS, type Biome } from '../data/biomes';
import { WEATHERS, WEATHER_EVENT_IDS, type WeatherId } from '../data/weather';
import type { RNG } from '../core/rng';

/**
 * The Director owns the timed biome cycle with a cross-fade corridor and the
 * day/night clock + weather scheduling. It produces a single interpolated
 * `BlendedState` each frame that everything else reads — the cross-fade lerps
 * ALL params simultaneously, never a single-frame swap. (isSeamless)
 */

export interface BlendedState {
  fog: THREE.Color;
  fogDensity: number;
  skyTop: THREE.Color;
  skyLow: THREE.Color;
  sun: THREE.Color;
  ground: THREE.Color;
  road: THREE.Color;
  night: number; // 0 day .. 1 night
  sunDir: THREE.Vector3;
  sunIntensity: number;
  ambient: number;
}

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();

export class Director {
  private rng: RNG;
  private order: number[];
  private idx = 0;
  private timer = 0;
  private inTransition = false;
  private clock = 6; // start at dawn
  private dayLen = 180; // seconds per full day

  // weather scheduling
  private weather: WeatherId = 'clear';
  private weatherTimer: number;
  private weatherDuration = 0;
  private inWeather = false;

  state: BlendedState = {
    fog: new THREE.Color(), fogDensity: 0.02, skyTop: new THREE.Color(), skyLow: new THREE.Color(),
    sun: new THREE.Color(), ground: new THREE.Color(), road: new THREE.Color(),
    night: 0, sunDir: new THREE.Vector3(), sunIntensity: 1, ambient: 0.6,
  };

  onBiomeEnter?: (b: Biome) => void;
  onWeatherChange?: (id: WeatherId, label: string) => void;

  constructor(rng: RNG) {
    this.rng = rng;
    // shuffled biome order (procedural), but keep all four in the loop
    this.order = [0, 1, 2, 3];
    for (let i = this.order.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [this.order[i], this.order[j]] = [this.order[j], this.order[i]];
    }
    this.weatherTimer = rng.range(25, 50);
    this.apply(1, this.currentBiome, this.currentBiome);
  }

  get currentBiome(): Biome { return BIOMES[this.order[this.idx]]; }
  get nextBiome(): Biome { return BIOMES[this.order[(this.idx + 1) % this.order.length]]; }
  get currentBiomeId(): string { return this.currentBiome.id; }

  /** call after construction to fire the first reveal */
  begin(): void { this.onBiomeEnter?.(this.currentBiome); }

  update(dt: number): void {
    // day/night clock
    this.clock = (this.clock + (24 / this.dayLen) * dt) % 24;

    // biome cycle
    this.timer += dt;
    const total = BIOME_SECONDS;
    if (!this.inTransition && this.timer >= total - TRANSITION_SECONDS) {
      this.inTransition = true;
    }
    if (this.inTransition && this.timer >= total) {
      // commit to next biome
      this.idx = (this.idx + 1) % this.order.length;
      this.timer = 0;
      this.inTransition = false;
      this.onBiomeEnter?.(this.currentBiome);
    }

    // blend factor for the corridor
    let mix = 1; // 1 = fully current
    let from = this.currentBiome;
    let to = this.currentBiome;
    if (this.inTransition) {
      const tStart = total - TRANSITION_SECONDS;
      const k = (this.timer - tStart) / TRANSITION_SECONDS; // 0..1
      mix = 1 - k;
      from = this.currentBiome;
      to = this.nextBiome;
    }

    // weather scheduling
    this.updateWeather(dt);

    this.apply(mix, from, to);
  }

  private updateWeather(dt: number): void {
    if (this.inWeather) {
      this.weatherDuration -= dt;
      if (this.weatherDuration <= 0) {
        this.inWeather = false;
        this.weather = 'clear';
        this.weatherTimer = this.rng.range(30, 60);
        this.onWeatherChange?.('clear', 'Clear');
      }
    } else {
      this.weatherTimer -= dt;
      if (this.weatherTimer <= 0) {
        // biome-weighted pick
        const biome = this.currentBiome;
        const weights = WEATHER_EVENT_IDS.map((id) => WEATHERS[id].baseWeight * (biome.weather[id] ?? 1));
        const total = weights.reduce((s, v) => s + v, 0);
        let r = this.rng.next() * total;
        let chosen: WeatherId = 'rain';
        for (let i = 0; i < WEATHER_EVENT_IDS.length; i++) { r -= weights[i]; if (r <= 0) { chosen = WEATHER_EVENT_IDS[i]; break; } }
        this.weather = chosen;
        this.inWeather = true;
        this.weatherDuration = this.rng.range(28, 55);
        this.onWeatherChange?.(chosen, WEATHERS[chosen].label);
      }
    }
  }

  get activeWeather(): WeatherId { return this.weather; }

  private apply(mix: number, from: Biome, to: Biome): void {
    const s = this.state;
    s.fog.copy(from.fog).lerp(tmpA.copy(to.fog), 1 - mix);
    s.fogDensity = from.fogDensity * mix + to.fogDensity * (1 - mix);
    s.skyTop.copy(from.sky).lerp(tmpA.copy(to.sky), 1 - mix);
    s.skyLow.copy(from.skyLow).lerp(tmpA.copy(to.skyLow), 1 - mix);
    s.sun.copy(from.sun).lerp(tmpA.copy(to.sun), 1 - mix);
    s.ground.copy(from.ground).lerp(tmpA.copy(to.ground), 1 - mix);
    s.road.copy(from.road).lerp(tmpA.copy(to.road), 1 - mix);

    // day/night
    const sunAngle = ((this.clock - 6) / 24) * Math.PI * 2; // sunrise at 6
    const elev = Math.sin(((this.clock - 6) / 12) * Math.PI); // -1..1, peak noon
    s.night = THREE.MathUtils.clamp(0.5 - elev * 0.9, 0, 1);
    s.sunDir.set(Math.cos(sunAngle) * 0.4, Math.max(0.02, elev), -0.9).normalize();
    s.sunIntensity = THREE.MathUtils.clamp(0.2 + elev * 1.1, 0.05, 1.3);
    s.ambient = 0.35 + (1 - s.night) * 0.45;

    // weather darkening over the top
    const w = WEATHERS[this.weather];
    if (this.inWeather) {
      // note: actual ramp handled in Weather class; here we tint toward darker
      tmpB.setRGB(0.06, 0.07, 0.09);
      s.fog.lerp(tmpB, w.dark * 0.5);
      s.skyTop.lerp(tmpB, w.dark * 0.45);
      s.skyLow.lerp(tmpB, w.dark * 0.4);
      s.fogDensity *= w.fogMul;
      s.sunIntensity *= w.sunMul;
      s.ambient *= 1 - w.dark * 0.3;
    }
  }

  get clockHours(): number { return this.clock; }

  /** force the day/night clock (QA / debug). 0..24 */
  setClock(h: number): void { this.clock = ((h % 24) + 24) % 24; }
}
