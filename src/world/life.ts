import * as THREE from 'three';
import type { RNG } from '../core/rng';
import { Road } from './road';
import type { Biome } from '../data/biomes';

/**
 * Two+ moving ambient life types, instanced (isAlive):
 *  - birds: a flock drifting overhead, flap via per-instance scale wobble.
 *  - ground critters: deer / pedestrians crossing or standing roadside.
 * Honking scatters the birds (scareBirds).
 */

const dummy = new THREE.Object3D();
const BIRDS = 48;
const CRITTERS = 26;

export class Life {
  group = new THREE.Group();
  private birds: THREE.InstancedMesh;
  private critters: THREE.InstancedMesh;
  private birdState: { x: number; y: number; z: number; vx: number; phase: number }[] = [];
  private critterState: { x: number; z: number; side: number; phase: number; active: boolean; deer: boolean }[] = [];
  private rng: RNG;
  private road: Road;
  private scare = 0;
  private spawnAccum = 0;
  private density = 1;

  constructor(rng: RNG, road: Road, biome: Biome) {
    this.rng = rng;
    this.road = road;

    // bird = stretched diamond
    const bg = new THREE.OctahedronGeometry(0.4, 0);
    bg.scale(2.4, 0.4, 0.8);
    this.birds = new THREE.InstancedMesh(bg, new THREE.MeshStandardMaterial({ color: 0x2b2b30, flatShading: true }), BIRDS);
    this.birds.frustumCulled = false;
    this.group.add(this.birds);
    for (let i = 0; i < BIRDS; i++) {
      this.birdState.push({
        x: rng.range(-60, 60), y: rng.range(22, 40), z: rng.range(-300, -30),
        vx: rng.range(-2, 2), phase: rng.range(0, 6.28),
      });
    }

    // critter = simple capsule-ish body (deer/pedestrian)
    const cg = new THREE.CapsuleGeometry(0.4, 1.0, 3, 6);
    cg.translate(0, 0.9, 0);
    this.critters = new THREE.InstancedMesh(cg, new THREE.MeshStandardMaterial({ color: 0x8a6b4a, flatShading: true }), CRITTERS);
    this.critters.castShadow = true;
    // frustum-cull the roadside critters (they live in the band ahead)
    this.critters.frustumCulled = true;
    this.critters.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -160), 320);
    this.group.add(this.critters);
    for (let i = 0; i < CRITTERS; i++) {
      this.critterState.push({ x: 0, z: 9999, side: 1, phase: 0, active: false, deer: biome.life.includes('deer') });
      dummy.position.set(0, -9999, 0); dummy.updateMatrix();
      this.critters.setMatrixAt(i, dummy.matrix);
    }
  }

  setDensity(d: number): void { this.density = d; }
  scareBirds(): void { this.scare = 1; }

  update(delta: number, dt: number, totalDist: number, t: number): void {
    // birds drift; recycle when behind
    for (let i = 0; i < BIRDS; i++) {
      const b = this.birdState[i];
      b.z += delta;
      b.x += b.vx * dt + this.scare * (b.x > 0 ? 30 : -30) * dt;
      if (b.z > 30) { b.z = -320 - this.rng.range(0, 60); b.x = this.rng.range(-70, 70); }
      const cx = this.road.curveX(totalDist + -b.z) * 0.6;
      dummy.position.set(b.x + cx, b.y, b.z);
      const flap = Math.sin(t * 9 + b.phase) * 0.5;
      dummy.rotation.set(0, Math.atan2(b.vx, -1), flap);
      dummy.scale.set(1, 1 + Math.abs(flap), 1);
      dummy.updateMatrix();
      this.birds.setMatrixAt(i, dummy.matrix);
    }
    this.birds.instanceMatrix.needsUpdate = true;
    this.scare = Math.max(0, this.scare - dt * 0.8);

    // critters advance + recycle
    let dirty = false;
    for (let i = 0; i < CRITTERS; i++) {
      const c = this.critterState[i];
      if (!c.active) continue;
      c.z += delta;
      if (c.z > 40) { c.active = false; dummy.position.set(0, -9999, 0); dummy.updateMatrix(); this.critters.setMatrixAt(i, dummy.matrix); dirty = true; continue; }
      const d = totalDist + -c.z;
      const cx = this.road.curveX(d);
      const cy = this.road.heightAt(d);
      const bob = Math.abs(Math.sin(t * 6 + c.phase)) * 0.12;
      dummy.position.set(cx + c.side * (10 + (i % 5) * 3), cy + bob, c.z);
      dummy.rotation.set(0, c.side > 0 ? -1.2 : 1.2, 0);
      dummy.scale.setScalar(c.deer ? 1.0 : 0.78);
      dummy.updateMatrix();
      this.critters.setMatrixAt(i, dummy.matrix);
      dirty = true;
    }
    if (dirty) this.critters.instanceMatrix.needsUpdate = true;

    this.spawnAccum += delta * 0.16 * this.density;
    const cap = Math.max(4, Math.floor(CRITTERS * this.density));
    let activeCritters = 0;
    for (const s of this.critterState) if (s.active) activeCritters++;
    while (this.spawnAccum > 10) {
      this.spawnAccum -= 10;
      if (activeCritters >= cap) break;
      const c = this.critterState.find((s) => !s.active);
      if (!c) continue;
      activeCritters++;
      c.active = true;
      c.side = this.rng.bool() ? 1 : -1;
      c.phase = this.rng.range(0, 6.28);
      c.z = -340 - this.rng.range(0, 40);
    }
  }

  setBiome(b: Biome): void {
    const deer = b.life.includes('deer');
    const ped = b.life.includes('pedestrian');
    const mat = this.critters.material as THREE.MeshStandardMaterial;
    mat.color.set(ped && !deer ? 0x4a5a7a : 0x8a6b4a);
    for (const c of this.critterState) c.deer = deer;
  }

  dispose(): void {
    this.birds.geometry.dispose();
    (this.birds.material as THREE.Material).dispose();
    this.critters.geometry.dispose();
    (this.critters.material as THREE.Material).dispose();
  }
}
