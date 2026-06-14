import * as THREE from 'three';
import type { RNG } from '../core/rng';
import { Road, ROAD_WIDTH } from './road';

/**
 * Knockable roadside props with a tiny custom physics layer (NOT Rapier — see
 * README for the production upgrade path). A small capped pool of rigid bodies:
 * each has position + velocity + angular velocity, integrates with gravity,
 * bounces, applies ground friction and settles (sleeps). Brushing the car
 * imparts an impulse — tumble + roll, never a penalty. (isInteractive)
 */

type Shape = 'cone' | 'bin' | 'ball';

interface Body {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  ang: THREE.Vector3;
  rot: THREE.Euler;
  radius: number;
  active: boolean;
  sleeping: boolean;
  z: number; // for recycle
}

const MAX = 10;
const GRAV = -26;

function geoFor(s: Shape): THREE.BufferGeometry {
  if (s === 'cone') { const g = new THREE.ConeGeometry(0.45, 1.1, 10); g.translate(0, 0.55, 0); return g; }
  if (s === 'bin') { const g = new THREE.CylinderGeometry(0.4, 0.34, 1.1, 10); g.translate(0, 0.55, 0); return g; }
  const g = new THREE.IcosahedronGeometry(0.5, 1); g.translate(0, 0.5, 0); return g;
}
function colFor(s: Shape): number { return s === 'cone' ? 0xe8662a : s === 'bin' ? 0x3a6e4a : 0xe8d23a; }

export class Props {
  group = new THREE.Group();
  private bodies: Body[] = [];
  private rng: RNG;
  private road: Road;
  private spawnAccum = 0;
  private enabled = true;

  constructor(rng: RNG, road: Road) {
    this.rng = rng;
    this.road = road;
    const shapes: Shape[] = ['cone', 'bin', 'ball'];
    for (let i = 0; i < MAX; i++) {
      const s = shapes[i % 3];
      const mesh = new THREE.Mesh(geoFor(s), new THREE.MeshStandardMaterial({ color: colFor(s), roughness: 0.7, flatShading: true }));
      mesh.castShadow = true;
      mesh.visible = false;
      this.group.add(mesh);
      this.bodies.push({
        mesh, pos: new THREE.Vector3(), vel: new THREE.Vector3(), ang: new THREE.Vector3(),
        rot: new THREE.Euler(), radius: s === 'ball' ? 0.5 : 0.45, active: false, sleeping: false, z: 9999,
      });
    }
  }

  setEnabled(on: boolean): void { this.enabled = on; }

  private spawn(totalDist: number): void {
    const b = this.bodies.find((x) => !x.active);
    if (!b) return;
    b.active = true;
    b.sleeping = false;
    b.z = -200 - this.rng.range(0, 60);
    const cx = this.road.curveX(totalDist + -b.z);
    const lane = this.rng.range(-ROAD_WIDTH / 2 + 1, ROAD_WIDTH / 2 - 1);
    b.pos.set(cx + lane, 0, b.z);
    b.vel.set(0, 0, 0);
    b.ang.set(0, 0, 0);
    b.rot.set(0, this.rng.range(0, 6.28), 0);
    b.mesh.visible = true;
  }

  /**
   * @param carX car world x  @param scroll meters scrolled this frame (added to z)
   */
  update(dt: number, scroll: number, totalDist: number, carX: number, carSpeed: number): void {
    if (this.enabled) {
      this.spawnAccum += scroll * 0.012;
      while (this.spawnAccum > 10) { this.spawnAccum -= 10; this.spawn(totalDist); }
    }

    for (const b of this.bodies) {
      if (!b.active) continue;
      b.pos.z += scroll; // world scrolls toward camera
      b.z = b.pos.z;

      // car collision: car sits near z in [-3,3] at x = carX
      if (!b.sleeping || b.pos.y > 0.05) {
        // integrate physics
        b.vel.y += GRAV * dt;
        b.pos.addScaledVector(b.vel, dt);
        if (b.pos.y < 0) {
          b.pos.y = 0;
          if (b.vel.y < 0) b.vel.y *= -0.32; // bounce
          // ground friction
          b.vel.x *= 0.86; b.vel.z *= 0.86;
          b.ang.multiplyScalar(0.9);
        }
        b.rot.x += b.ang.x * dt; b.rot.y += b.ang.y * dt; b.rot.z += b.ang.z * dt;
        // settle test
        if (b.pos.y < 0.02 && b.vel.lengthSq() < 0.05 && b.ang.lengthSq() < 0.05) {
          b.sleeping = true; b.vel.set(0, 0, 0); b.ang.set(0, 0, 0);
        }
      }

      // collision with car (kinematic): nudge if close
      const dx = b.pos.x - carX;
      const dz = b.pos.z; // car ~ z=0
      if (Math.abs(dz) < 3 && Math.abs(dx) < 1.6 && b.pos.y < 1.4) {
        b.sleeping = false;
        const dir = Math.sign(dx) || (this.rng.bool() ? 1 : -1);
        const impulse = 3 + carSpeed * 0.25;
        b.vel.x += dir * impulse;
        b.vel.y += 4 + Math.random() * 3;
        b.vel.z -= 2;
        b.ang.set(this.rng.range(-8, 8), this.rng.range(-8, 8), this.rng.range(-8, 8));
      }

      b.mesh.position.copy(b.pos);
      b.mesh.rotation.copy(b.rot);

      if (b.pos.z > 30) { b.active = false; b.mesh.visible = false; }
    }
  }

  get activeCount(): number { return this.bodies.filter((b) => b.active).length; }

  dispose(): void {
    for (const b of this.bodies) { b.mesh.geometry.dispose(); (b.mesh.material as THREE.Material).dispose(); }
  }
}
