import * as THREE from 'three';
import type { Biome, PropKind } from '../data/biomes';
import type { RNG } from '../core/rng';
import { Road } from './road';

/**
 * Instanced + pooled roadside scatter. One InstancedMesh per prop kind; a ring
 * buffer of instance slots that get repositioned just inside the fog wall and
 * recycled once they pass the camera. One draw call per kind. (isPooled/isAlive)
 */

interface Slot {
  z: number; // world z
  side: number;
  dist: number; // distance value used for curveX
  kind: PropKind;
  scale: number;
  active: boolean;
}

const SPAWN_Z = -360; // just inside fog
const RECYCLE_Z = 50;
const dummy = new THREE.Object3D();

function geoFor(kind: PropKind): THREE.BufferGeometry {
  switch (kind) {
    case 'tree': {
      const g = new THREE.ConeGeometry(1.6, 4.2, 7);
      g.translate(0, 2.6, 0);
      return g;
    }
    case 'pine': {
      const g = new THREE.ConeGeometry(1.2, 5.2, 6);
      g.translate(0, 3.2, 0);
      return g;
    }
    case 'palm': {
      const g = new THREE.ConeGeometry(2.2, 1.6, 6);
      g.translate(0, 5.2, 0);
      return g;
    }
    case 'rock': {
      const g = new THREE.DodecahedronGeometry(1.1, 0);
      g.translate(0, 0.7, 0);
      return g;
    }
    case 'cactus': {
      const g = new THREE.CylinderGeometry(0.4, 0.5, 3, 6);
      g.translate(0, 1.5, 0);
      return g;
    }
    case 'building': {
      const g = new THREE.BoxGeometry(6, 16, 6);
      g.translate(0, 8, 0);
      return g;
    }
  }
}

function colorFor(kind: PropKind): number {
  switch (kind) {
    case 'tree': return 0x3f6b34;
    case 'pine': return 0x2f5230;
    case 'palm': return 0x4e8c43;
    case 'rock': return 0x6d6f6a;
    case 'cactus': return 0x4a7a45;
    case 'building': return 0x6a7488;
  }
}

class KindMesh {
  mesh: THREE.InstancedMesh;
  slots: Slot[] = [];
  constructor(kind: PropKind, max: number) {
    const mat = new THREE.MeshStandardMaterial({ color: colorFor(kind), roughness: 0.9, flatShading: true });
    this.mesh = new THREE.InstancedMesh(geoFor(kind), mat, max);
    this.mesh.castShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = max;
    for (let i = 0; i < max; i++) {
      this.slots.push({ z: 9999, side: 1, dist: 0, kind, scale: 1, active: false });
      dummy.position.set(0, -9999, 0);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
    }
  }
}

const KINDS: PropKind[] = ['tree', 'pine', 'palm', 'rock', 'cactus', 'building'];
const MAX_PER_KIND = 60;

export class Scatter {
  group = new THREE.Group();
  private meshes = new Map<PropKind, KindMesh>();
  private rng: RNG;
  private road: Road;
  private spawnAccum = 0;
  private density = 1; // 0..1, scaled by perf tier
  private biome: Biome;

  constructor(rng: RNG, road: Road, biome: Biome) {
    this.rng = rng;
    this.road = road;
    this.biome = biome;
    for (const k of KINDS) {
      const km = new KindMesh(k, MAX_PER_KIND);
      this.meshes.set(k, km);
      this.group.add(km.mesh);
    }
  }

  setDensity(d: number): void { this.density = d; }
  setBiome(b: Biome): void { this.biome = b; }

  private pickKind(): PropKind {
    const props = this.biome.props;
    let total = 0;
    for (const p of props) total += p.weight;
    let r = this.rng.next() * total;
    for (const p of props) { r -= p.weight; if (r <= 0) return p.kind; }
    return props[0].kind;
  }

  private freeSlot(kind: PropKind): Slot | null {
    const km = this.meshes.get(kind)!;
    for (const s of km.slots) if (!s.active) return s;
    return null;
  }

  update(delta: number, totalDist: number): void {
    // advance + recycle existing
    for (const km of this.meshes.values()) {
      let dirty = false;
      for (let i = 0; i < km.slots.length; i++) {
        const s = km.slots[i];
        if (!s.active) continue;
        s.z += delta;
        if (s.z > RECYCLE_Z) {
          s.active = false;
          dummy.position.set(0, -9999, 0);
          dummy.updateMatrix();
          km.mesh.setMatrixAt(i, dummy.matrix);
          dirty = true;
          continue;
        }
        const cx = this.road.curveX(totalDist + -s.z);
        const edge = (s.kind === 'building' ? 11 : 9) + this.rng2(s) * 60;
        dummy.position.set(cx + s.side * edge, 0, s.z);
        dummy.rotation.set(0, s.dist, 0);
        dummy.scale.setScalar(s.scale);
        dummy.updateMatrix();
        km.mesh.setMatrixAt(i, dummy.matrix);
        dirty = true;
      }
      if (dirty) km.mesh.instanceMatrix.needsUpdate = true;
    }

    // spawn new just inside fog, rate scaled by density
    this.spawnAccum += delta * (0.9 * this.density);
    while (this.spawnAccum > 10) {
      this.spawnAccum -= 10;
      const kind = this.pickKind();
      const s = this.freeSlot(kind);
      if (!s) continue;
      s.active = true;
      s.kind = kind;
      s.side = this.rng.bool() ? 1 : -1;
      s.scale = this.rng.range(0.7, 1.5);
      s.dist = this.rng.range(0, Math.PI * 2);
      s.z = SPAWN_Z - this.rng.range(0, 40);
    }
  }

  // deterministic-ish edge jitter per slot using its dist field
  private rng2(s: Slot): number { return (Math.sin(s.dist * 12.9898) * 43758.5453) % 1; }

  dispose(): void {
    for (const km of this.meshes.values()) {
      km.mesh.geometry.dispose();
      (km.mesh.material as THREE.Material).dispose();
    }
  }
}
