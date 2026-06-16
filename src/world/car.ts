import * as THREE from 'three';
import { makeDiscTexture } from './textures';
import { getVehicle, DEFAULT_VEHICLE, type VehicleDef, type VehicleModel } from '../car/vehicles';

const SMOKE = 60; // tyre-smoke particle pool

/**
 * Player vehicle. Wraps a swappable procedural model from the roster
 * (src/car/vehicles.ts). Selecting a different vehicle rebuilds the model in
 * place — position/lane/heading live on `root`, which is preserved — and the
 * handling code in main.ts reads `car.stats` so each vehicle drives to its own
 * real-derived feel. The body group receives lean/pitch/squash + (for the
 * motorcycle) a big lean into curves.
 */
export class Car {
  root = new THREE.Group(); // positioned by handling (x = lane offset)
  body = new THREE.Group(); // gets lean/pitch/squash
  def: VehicleDef;

  private model!: VehicleModel;
  private wheels: THREE.Object3D[] = [];
  private headlightL!: THREE.SpotLight;
  private headlightR!: THREE.SpotLight;
  private glowL!: THREE.Sprite;
  private glowR!: THREE.Sprite;
  private disc: THREE.Texture;
  private wheelRadius = 0.42;
  private leanGain = 0.5; // motorcycle leans HARD

  // tyre smoke (Points) — world-space puffs that bloom + fade while drifting.
  // Lives on `root` so it inherits car position; puffs use local coords that
  // trail behind the rear wheels and rise/expand. Pooled, no per-frame alloc.
  private smoke!: THREE.Points;
  private smokeMat!: THREE.PointsMaterial;
  private smokePos!: Float32Array;
  private smokeLife = new Float32Array(SMOKE);
  private smokeVel: THREE.Vector3[] = [];
  private smokeCursor = 0;

  constructor(id: string = DEFAULT_VEHICLE) {
    this.disc = makeDiscTexture(true);
    this.root.add(this.body);
    this.def = getVehicle(id);
    this.build(this.def);
    this.buildSmoke();
  }

  private buildSmoke(): void {
    this.smokePos = new Float32Array(SMOKE * 3);
    for (let i = 0; i < SMOKE; i++) {
      this.smokePos[i * 3 + 1] = -9999;
      this.smokeVel.push(new THREE.Vector3());
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.smokePos, 3));
    this.smokeMat = new THREE.PointsMaterial({
      map: this.disc, color: 0xdcdce0, size: 2.2, transparent: true,
      opacity: 0.55, depthWrite: false, blending: THREE.NormalBlending, sizeAttenuation: true,
    });
    this.smoke = new THREE.Points(geo, this.smokeMat);
    this.smoke.frustumCulled = false;
    this.root.add(this.smoke);
  }

  /** Emit a tyre-smoke puff behind a rear wheel (local x offset). */
  emitSmoke(side: number): void {
    const i = this.smokeCursor;
    this.smokeCursor = (this.smokeCursor + 1) % SMOKE;
    this.smokePos[i * 3] = side * 0.9 + (Math.random() - 0.5) * 0.4;
    this.smokePos[i * 3 + 1] = 0.3;
    this.smokePos[i * 3 + 2] = -1.6 + (Math.random() - 0.5) * 0.4;
    this.smokeVel[i].set((Math.random() - 0.5) * 1.2, 0.6 + Math.random() * 0.8, 1.5 + Math.random() * 1.5);
    this.smokeLife[i] = 1;
  }

  /** Advance + fade smoke puffs. Called each render frame. */
  updateSmoke(dt: number): void {
    let any = false;
    for (let i = 0; i < SMOKE; i++) {
      if (this.smokeLife[i] <= 0) continue;
      any = true;
      this.smokeLife[i] -= dt * 0.9;
      const v = this.smokeVel[i];
      this.smokePos[i * 3] += v.x * dt;
      this.smokePos[i * 3 + 1] += v.y * dt;
      this.smokePos[i * 3 + 2] += v.z * dt;
      v.multiplyScalar(0.94);
      if (this.smokeLife[i] <= 0) this.smokePos[i * 3 + 1] = -9999;
    }
    this.smoke.geometry.attributes.position.needsUpdate = true;
    this.smokeMat.opacity = any ? 0.55 : 0;
  }

  /** Current stat block the handling/camera code reads. */
  get stats(): VehicleDef { return this.def; }

  /** Swap to a different vehicle, preserving position/lane/heading on `root`. */
  setVehicle(id: string): void {
    const def = getVehicle(id);
    if (def.id === this.def.id && this.model) return;
    this.def = def;
    this.build(def);
  }

  private build(def: VehicleDef): void {
    // tear down previous model
    if (this.model) {
      this.body.remove(this.model.group);
      this.disposeGroup(this.model.group);
    }
    this.wheels.length = 0;

    const m = def.build();
    this.model = m;
    this.wheels = m.wheels;
    // explicit radius (GLB) wins; else probe a procedural cylinder wheel
    const w0 = m.wheels[0] as THREE.Mesh | undefined;
    this.wheelRadius = m.wheelRadius
      ?? (w0?.geometry ? (w0.geometry as THREE.CylinderGeometry).parameters.radiusTop : 0.42);
    this.leanGain = def.lean;
    this.body.add(m.group);

    // mount spotlights + glow sprites at the model's headlight anchors
    const a = m.headlightAnchors;
    const left = a[0] ?? new THREE.Vector3(-0.6, 0.7, 2.1);
    const right = a[a.length - 1] ?? new THREE.Vector3(0.6, 0.7, 2.1);
    this.headlightL = this.mkSpot(left);
    this.headlightR = this.mkSpot(right);
    this.glowL = this.mkGlow(left);
    this.glowR = this.mkGlow(right);
  }

  private mkSpot(p: THREE.Vector3): THREE.SpotLight {
    const s = new THREE.SpotLight(0xfff1cf, 0, 60, Math.PI / 7, 0.5, 1.4);
    s.position.copy(p);
    s.target.position.set(p.x * 1.5, 0, p.z + 28);
    this.body.add(s);
    this.body.add(s.target);
    return s;
  }

  private mkGlow(p: THREE.Vector3): THREE.Sprite {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.disc, color: 0xfff0c0, transparent: true, opacity: 0, depthWrite: false }));
    sp.scale.set(1.2, 1.2, 1);
    sp.position.set(p.x, p.y, p.z + 0.1);
    this.body.add(sp);
    return sp;
  }

  private disposeGroup(g: THREE.Group): void {
    // GLB clones (Ferrari) share geometry with the cached template — disposing
    // would break every other instance and future rebuilds. Skip those.
    if (g.userData.keepGeometry) return;
    g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry?.dispose();
    });
  }

  /** spin wheels by speed (m/s) */
  spin(speed: number, dt: number): void {
    const a = (speed / Math.max(0.2, this.wheelRadius)) * dt;
    for (const w of this.wheels) w.rotation.x += a;
  }

  /**
   * Apply visual feel. `lean01` is a signed -1..1 cornering signal; the body
   * leans by it scaled by the vehicle's lean gain (motorcycle tips right over,
   * cars roll subtly). roll/pitch/squash come from the handling integrator.
   */
  setFeel(roll: number, pitch: number, squash: number, lean01 = 0): void {
    this.body.rotation.z = roll - lean01 * this.leanGain * 0.55;
    this.body.rotation.x = pitch;
    this.body.scale.y = 1 - squash;
  }

  /** front wheels steer angle */
  steerWheels(angle: number): void {
    if (this.wheels[0]) this.wheels[0].rotation.y = angle;
    if (this.wheels[1]) this.wheels[1].rotation.y = angle;
  }

  setHeadlights(on: number): void {
    const intensity = on * 3.2;
    this.headlightL.intensity = intensity;
    this.headlightR.intensity = intensity;
    this.glowL.material.opacity = on * 0.9;
    this.glowR.material.opacity = on * 0.9;
  }
}
