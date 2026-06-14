import * as THREE from 'three';
import { makeDiscTexture } from './textures';
import { WEATHERS, type WeatherId } from '../data/weather';

/**
 * GPU Points weather: rain / snow / fall-leaves recycled within a box around
 * the camera (pooled — particles wrap, never respawn). Intensity ramps the
 * material opacity + active count. Lightning = a fullscreen-ish flash handled
 * by the caller via the `flash` callback. Quality-scaled counts. (isWeathered)
 */

const BOX = { x: 60, y: 50, z: 220 };

export class Weather {
  group = new THREE.Group();
  private pts: THREE.Points;
  private geo: THREE.BufferGeometry;
  private mat: THREE.PointsMaterial;
  private maxCount: number;
  private activeCount = 0;
  private kind: WeatherId = 'clear';
  private intensity = 0; // 0..1 ramp
  private target = 0;
  private qualityMul = 1;
  private reduced = false;

  // lightning
  private flashTimer = 0;
  private nextStrike = 4;
  onFlash?: (v: number) => void;

  constructor(maxCount = 6000) {
    this.maxCount = maxCount;
    this.geo = new THREE.BufferGeometry();
    const pos = new Float32Array(maxCount * 3);
    for (let i = 0; i < maxCount; i++) {
      pos[i * 3] = (Math.random() - 0.5) * BOX.x * 2;
      pos[i * 3 + 1] = Math.random() * BOX.y;
      pos[i * 3 + 2] = -Math.random() * BOX.z;
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.mat = new THREE.PointsMaterial({
      map: makeDiscTexture(false),
      color: 0xbfd0e0,
      size: 0.5,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    this.pts = new THREE.Points(this.geo, this.mat);
    this.pts.frustumCulled = false;
    this.group.add(this.pts);
  }

  setQuality(mul: number): void { this.qualityMul = mul; }
  setReduced(r: boolean): void { this.reduced = r; }

  /** transition to a weather state (smooth ramp via target intensity). */
  setWeather(id: WeatherId): void {
    if (id === this.kind && this.target > 0) return;
    if (id === 'clear') { this.target = 0; return; }
    this.kind = id;
    this.target = 1;
    const def = WEATHERS[id];
    this.activeCount = Math.min(this.maxCount, Math.floor(def.count * this.qualityMul));
    switch (def.particle) {
      case 'rain':
        this.mat.color.set(0xaecbe0); this.mat.size = 0.45; break;
      case 'snow':
        this.mat.color.set(0xffffff); this.mat.size = 0.8; break;
      case 'leaf':
        this.mat.color.set(0xd98a3a); this.mat.size = 1.1; break;
      default: break;
    }
  }

  clear(): void { this.target = 0; }

  get current(): WeatherId { return this.target > 0 ? this.kind : 'clear'; }
  get ramp(): number { return this.intensity; }

  update(dt: number, carPos: THREE.Vector3): void {
    // ramp intensity toward target
    const rate = 0.4;
    this.intensity += Math.sign(this.target - this.intensity) * Math.min(rate * dt, Math.abs(this.target - this.intensity));
    this.pts.visible = this.intensity > 0.01;
    if (!this.pts.visible) { this.mat.opacity = 0; return; }

    this.group.position.set(carPos.x, 0, carPos.z);

    const def = WEATHERS[this.kind];
    this.mat.opacity = this.intensity * (def.particle === 'leaf' ? 0.95 : 0.7);

    const pos = this.geo.attributes.position.array as Float32Array;
    const fallY = def.particle === 'snow' ? 9 : def.particle === 'leaf' ? 4 : 42;
    const drift = def.particle === 'snow' ? 6 : def.particle === 'leaf' ? 14 : 1.5;
    const mb = this.reduced ? 0.6 : 1;
    for (let i = 0; i < this.activeCount; i++) {
      const i3 = i * 3;
      pos[i3 + 1] -= fallY * dt * mb;
      pos[i3] += Math.sin((i + performance.now() * 0.001) * 0.5) * drift * dt * mb;
      pos[i3 + 2] += 22 * dt; // world scrolls toward camera
      if (pos[i3 + 1] < 0) {
        pos[i3 + 1] = BOX.y;
        pos[i3] = (Math.random() - 0.5) * BOX.x * 2;
        pos[i3 + 2] = -Math.random() * BOX.z;
      }
      if (pos[i3 + 2] > 30) pos[i3 + 2] -= BOX.z;
    }
    // hide unused particles
    for (let i = this.activeCount; i < this.maxCount; i++) pos[i * 3 + 1] = -9999;
    this.geo.attributes.position.needsUpdate = true;

    // lightning for storm
    if (def.lightning && this.intensity > 0.5 && !this.reduced) {
      this.nextStrike -= dt;
      if (this.nextStrike <= 0) {
        this.flashTimer = 0.22;
        this.nextStrike = 4 + Math.random() * 8;
      }
    }
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      const v = Math.max(0, this.flashTimer / 0.22);
      this.onFlash?.(v * v);
    } else {
      this.onFlash?.(0);
    }
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.map?.dispose();
    this.mat.dispose();
  }
}
