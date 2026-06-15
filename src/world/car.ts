import * as THREE from 'three';
import { makeDiscTexture } from './textures';
import { getVehicle, DEFAULT_VEHICLE, type VehicleDef, type VehicleModel } from '../car/vehicles';

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
  private wheels: THREE.Mesh[] = [];
  private headlightL!: THREE.SpotLight;
  private headlightR!: THREE.SpotLight;
  private glowL!: THREE.Sprite;
  private glowR!: THREE.Sprite;
  private disc: THREE.Texture;
  private wheelRadius = 0.42;
  private leanGain = 0.5; // motorcycle leans HARD

  constructor(id: string = DEFAULT_VEHICLE) {
    this.disc = makeDiscTexture(true);
    this.root.add(this.body);
    this.def = getVehicle(id);
    this.build(this.def);
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
    this.wheelRadius = m.wheels.length ? (m.wheels[0].geometry as THREE.CylinderGeometry).parameters.radiusTop : 0.42;
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
