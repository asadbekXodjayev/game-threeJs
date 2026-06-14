import * as THREE from 'three';

export type QualityTier = 0 | 1 | 2; // 0 high, 1 mid, 2 low

/**
 * Runtime adaptive-quality manager. Samples FPS; if it stays below target it
 * steps down a quality ladder: DPR first, then a `tier` signal the world reads
 * to thin shadows / particles / prop density. Recovers when there's headroom.
 * Adapted from the cars-ThreeJs PerfManager (isFast gate).
 */
export class PerfManager {
  private renderer: THREE.WebGLRenderer;
  private samples: number[] = [];
  private last = performance.now();
  private cooldown = 0;
  private readonly ladder: number[];
  private dprTier = 0;

  fps = 60;
  /** 0=high .. 2=low. World subsystems read this to scale work. */
  tier: QualityTier = 0;
  /** when set, auto-stepping is frozen at this tier (user override). */
  locked: QualityTier | null = null;
  onTierChange?: (tier: QualityTier) => void;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    const cap = Math.min(window.devicePixelRatio || 1, 2);
    this.ladder = [cap, Math.min(cap, 1.25), 1, 0.8].filter(
      (v, i, a) => a.indexOf(v) === i
    );
    renderer.setPixelRatio(this.ladder[0]);
  }

  lock(tier: QualityTier | null): void {
    this.locked = tier;
    if (tier !== null) this.setTier(tier);
  }

  private setTier(t: QualityTier): void {
    if (t === this.tier) return;
    this.tier = t;
    // map quality tier onto a DPR rung as well
    this.dprTier = Math.min(t, this.ladder.length - 1);
    this.renderer.setPixelRatio(this.ladder[this.dprTier]);
    this.onTierChange?.(t);
  }

  tick(): void {
    const now = performance.now();
    const dt = now - this.last;
    this.last = now;
    if (dt <= 0) return;
    const fps = 1000 / dt;
    this.samples.push(fps);
    if (this.samples.length > 60) this.samples.shift();
    if (this.locked !== null) {
      if (this.samples.length >= 30) {
        this.fps = this.samples.reduce((s, v) => s + v, 0) / this.samples.length;
      }
      return;
    }
    if (this.cooldown > 0) { this.cooldown--; return; }
    if (this.samples.length < 40) return;

    const avg = this.samples.reduce((s, v) => s + v, 0) / this.samples.length;
    this.fps = avg;

    if (avg < 46 && this.tier < 2) {
      this.setTier((this.tier + 1) as QualityTier);
      this.resetWindow();
    } else if (avg > 57 && this.tier > 0) {
      this.setTier((this.tier - 1) as QualityTier);
      this.resetWindow();
    }
  }

  private resetWindow(): void {
    this.samples.length = 0;
    this.cooldown = 100;
  }
}
