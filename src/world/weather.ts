import * as THREE from 'three';
import { makeDiscTexture } from './textures';
import { WEATHERS, type WeatherId } from '../data/weather';

/**
 * GPU Points weather: rain / snow / fall-leaves recycled within a box around
 * the camera (pooled — particles wrap, never respawn). Intensity ramps the
 * material opacity + active count. Lightning = a fullscreen-ish flash handled
 * by the caller via the `flash` callback. Quality-scaled counts.
 *
 * Tornado (follow-up): a distant cinematic funnel — a tapered cone with a
 * swirling shader plus a debris Points swarm at its base. Mostly far + never a
 * threat; intensity ramps it in/out like everything else. (isWeathered ≥5)
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

  // tornado
  private tornadoGroup = new THREE.Group();
  private funnel: THREE.Mesh;
  private funnelMat: THREE.ShaderMaterial;
  private debris: THREE.Points;
  private debrisGeo: THREE.BufferGeometry;
  /** 0..1 how present the tornado is (for audio roar). */
  tornadoLevel = 0;

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

    // ---- tornado funnel ----
    const fgeo = new THREE.CylinderGeometry(7, 28, 120, 24, 12, true);
    fgeo.translate(0, 60, 0);
    this.funnelMat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying float vY;
        void main(){ vUv = uv; vY = position.y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv; varying float vY; uniform float uTime; uniform float uOpacity;
        float hash(vec2 p){ return fract(sin(dot(p,vec2(41.3,289.1)))*43758.5); }
        void main(){
          float swirl = vUv.x * 8.0 + uTime * 2.2 - vY * 0.06;
          float bands = 0.5 + 0.5*sin(swirl*6.28);
          float n = hash(floor(vec2(vUv.x*30.0 + uTime*3.0, vY*0.4)));
          float dens = bands*0.6 + n*0.4;
          // denser/darker low, wispy up
          float vfade = smoothstep(1.0, 0.1, vUv.y);
          vec3 col = mix(vec3(0.25,0.24,0.27), vec3(0.55,0.54,0.58), dens);
          float a = dens * vfade * 0.7 * uOpacity;
          gl_FragColor = vec4(col, a);
        }
      `,
    });
    this.funnel = new THREE.Mesh(fgeo, this.funnelMat);
    this.tornadoGroup.add(this.funnel);

    // debris swarm at the base
    const DEB = 260;
    this.debrisGeo = new THREE.BufferGeometry();
    const dp = new Float32Array(DEB * 3);
    for (let i = 0; i < DEB; i++) {
      const a = Math.random() * Math.PI * 2; const r = 6 + Math.random() * 24;
      dp[i * 3] = Math.cos(a) * r; dp[i * 3 + 1] = Math.random() * 40; dp[i * 3 + 2] = Math.sin(a) * r;
    }
    this.debrisGeo.setAttribute('position', new THREE.BufferAttribute(dp, 3));
    this.debris = new THREE.Points(this.debrisGeo, new THREE.PointsMaterial({
      color: 0x4a4540, size: 1.4, transparent: true, opacity: 0, depthWrite: false,
    }));
    this.tornadoGroup.add(this.debris);
    this.tornadoGroup.visible = false;
    this.tornadoGroup.position.set(150, 0, -300);
    this.group.add(this.tornadoGroup);
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

    const def = WEATHERS[this.kind];
    const isTornado = !!def.tornado && this.target > 0;

    // ---- tornado funnel ----
    const tornLvl = isTornado ? this.intensity : 0;
    this.tornadoLevel += (tornLvl - this.tornadoLevel) * Math.min(1, 2 * dt);
    this.tornadoGroup.visible = this.tornadoLevel > 0.01;
    if (this.tornadoGroup.visible) {
      const t = performance.now() * 0.001;
      this.funnelMat.uniforms.uTime.value = t;
      this.funnelMat.uniforms.uOpacity.value = this.tornadoLevel;
      (this.debris.material as THREE.PointsMaterial).opacity = this.tornadoLevel * 0.8;
      // keep it far off the road, slowly drifting along
      this.tornadoGroup.position.set(carPos.x + 170, 0, carPos.z - 320 + Math.sin(t * 0.15) * 60);
      this.funnel.rotation.y = t * 1.4;
      this.debris.rotation.y = -t * 2.2;
    }

    // ---- particle field (rain/snow/leaf) ----
    const hasParticles = def.particle !== 'none' && this.intensity > 0.01;
    this.pts.visible = hasParticles;
    if (!hasParticles) {
      this.mat.opacity = 0;
    } else {
      this.group.position.set(carPos.x, 0, carPos.z);
      this.mat.opacity = this.intensity * (def.particle === 'leaf' ? 0.95 : 0.7);
      const pos = this.geo.attributes.position.array as Float32Array;
      const fallY = def.particle === 'snow' ? 9 : def.particle === 'leaf' ? 4 : 42;
      const drift = def.particle === 'snow' ? 6 : def.particle === 'leaf' ? 14 : 1.5;
      const mb = this.reduced ? 0.6 : 1;
      for (let i = 0; i < this.activeCount; i++) {
        const i3 = i * 3;
        pos[i3 + 1] -= fallY * dt * mb;
        pos[i3] += Math.sin((i + performance.now() * 0.001) * 0.5) * drift * dt * mb;
        pos[i3 + 2] += 22 * dt;
        if (pos[i3 + 1] < 0) {
          pos[i3 + 1] = BOX.y;
          pos[i3] = (Math.random() - 0.5) * BOX.x * 2;
          pos[i3 + 2] = -Math.random() * BOX.z;
        }
        if (pos[i3 + 2] > 30) pos[i3 + 2] -= BOX.z;
      }
      for (let i = this.activeCount; i < this.maxCount; i++) pos[i * 3 + 1] = -9999;
      this.geo.attributes.position.needsUpdate = true;
    }

    // group position fallback when only tornado is active
    if (!hasParticles && this.tornadoGroup.visible) this.group.position.set(carPos.x, 0, carPos.z);

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
    this.funnel.geometry.dispose(); this.funnelMat.dispose();
    this.debrisGeo.dispose(); (this.debris.material as THREE.Material).dispose();
  }
}
