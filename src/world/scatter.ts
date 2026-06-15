import * as THREE from 'three';
import type { Biome, PropKind } from '../data/biomes';
import type { RNG } from '../core/rng';
import { Road } from './road';

/**
 * Instanced + pooled roadside scatter. One InstancedMesh per prop kind; a ring
 * buffer of instance slots that get repositioned just inside the fog wall and
 * recycled once they pass the camera. One draw call per kind. (isPooled/isAlive)
 *
 * P1 populate: many more slots per kind, a higher spawn rate, two roadside
 * bands (near + far), and added foliage kinds (bush/grass) so the verge reads
 * full. Counts scale with the quality tier via setDensity so weak GPUs stay
 * above the FPS floor.
 */

interface Slot {
  z: number; // world z
  side: number;
  rot: number;
  edge: number; // lateral distance from road centre
  kind: PropKind;
  scale: number;
  active: boolean;
}

const SPAWN_Z = -380; // just inside fog
const RECYCLE_Z = 55;
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
    case 'bush': {
      const g = new THREE.IcosahedronGeometry(0.9, 0);
      g.scale(1.3, 0.8, 1.3);
      g.translate(0, 0.6, 0);
      return g;
    }
    case 'grass': {
      // a small tuft = a couple of crossed blades
      const g = new THREE.ConeGeometry(0.28, 1.1, 4);
      g.translate(0, 0.55, 0);
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
    case 'bush': return 0x46772f;
    case 'grass': return 0x5f8a3a;
  }
}

class KindMesh {
  mesh: THREE.InstancedMesh;
  slots: Slot[] = [];
  cap: number; // active cap (density-scaled)
  constructor(kind: PropKind, max: number) {
    const mat = new THREE.MeshStandardMaterial({ color: colorFor(kind), roughness: 0.9, flatShading: true });
    this.mesh = new THREE.InstancedMesh(geoFor(kind), mat, max);
    this.mesh.castShadow = kind !== 'grass';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = max;
    this.cap = max;
    // Per-object frustum CULLING: the instances live in a known band ahead of
    // the camera (z ≈ -380..55). A manual bounding sphere centred on that band
    // lets three.js cull this whole InstancedMesh (drops the draw call) the
    // moment the camera looks away from the road. (P4 culling proof)
    this.mesh.frustumCulled = true;
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -160), 320);
    this.mesh.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 6);
    for (let i = 0; i < max; i++) {
      this.slots.push({ z: 9999, side: 1, rot: 0, edge: 12, kind, scale: 1, active: false });
      dummy.position.set(0, -9999, 0);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
    }
  }
}

const KINDS: PropKind[] = ['tree', 'pine', 'palm', 'rock', 'cactus', 'building', 'bush', 'grass'];
// per-kind pool sizes (foliage gets more). Bumped for a fuller world (P4) —
// still instanced (one draw call per kind) and density-scaled per quality tier.
const MAX_FOR: Partial<Record<PropKind, number>> = {
  tree: 150, pine: 150, palm: 100, rock: 110, cactus: 70, building: 110, bush: 220, grass: 380,
};

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
      const km = new KindMesh(k, MAX_FOR[k] ?? 60);
      this.meshes.set(k, km);
      this.group.add(km.mesh);
    }
  }

  setDensity(d: number): void {
    this.density = d;
    // scale the active cap per kind so weak GPUs draw fewer instances
    for (const km of this.meshes.values()) km.cap = Math.max(8, Math.floor(km.slots.length * d));
  }
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
    let activeCount = 0;
    for (const s of km.slots) if (s.active) activeCount++;
    if (activeCount >= km.cap) return null;
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
        const d = totalDist + -s.z;
        const cx = this.road.curveX(d);
        const cy = this.road.heightAt(d);
        dummy.position.set(cx + s.side * s.edge, cy, s.z);
        dummy.rotation.set(0, s.rot, 0);
        dummy.scale.setScalar(s.scale);
        dummy.updateMatrix();
        km.mesh.setMatrixAt(i, dummy.matrix);
        dirty = true;
      }
      if (dirty) km.mesh.instanceMatrix.needsUpdate = true;
    }

    // spawn new just inside fog, rate scaled by density (much higher base now)
    this.spawnAccum += delta * (5.2 * this.density);
    while (this.spawnAccum > 10) {
      this.spawnAccum -= 10;
      const kind = this.pickKind();
      const s = this.freeSlot(kind);
      if (!s) continue;
      s.active = true;
      s.kind = kind;
      s.side = this.rng.bool() ? 1 : -1;
      // grass/bush hug the verge; trees fan out wide
      const near = kind === 'grass' || kind === 'bush';
      const baseEdge = kind === 'building' ? 12 : near ? 8 : 9;
      const spread = kind === 'building' ? 50 : near ? 14 : 70;
      s.edge = baseEdge + this.rng.next() * spread;
      s.scale = kind === 'grass' ? this.rng.range(0.6, 1.3)
        : kind === 'building' ? this.rng.range(0.7, 1.8)
        : this.rng.range(0.7, 1.6);
      s.rot = this.rng.range(0, Math.PI * 2);
      s.z = SPAWN_Z - this.rng.range(0, 60);
    }
  }

  get activeCount(): number {
    let n = 0;
    for (const km of this.meshes.values()) for (const s of km.slots) if (s.active) n++;
    return n;
  }

  dispose(): void {
    for (const km of this.meshes.values()) {
      km.mesh.geometry.dispose();
      (km.mesh.material as THREE.Material).dispose();
    }
  }
}
