import * as THREE from 'three';
import type { RNG } from '../core/rng';

/**
 * The open-world playground. A field of bounce toys — trampolines, kicker ramps,
 * boost pads, domes and drive-through rings — scattered across one tile that
 * WRAPS toroidally around the player: every obstacle is rendered at the copy of
 * itself nearest the car, so the field is effectively infinite while only ~70
 * objects ever exist. Each type is one (or two) InstancedMesh, so the whole
 * playground is a handful of draw calls. Collision is a cheap per-frame distance
 * test in main.ts via `sample()`; main applies the jump/boost it returns.
 */

export const OB = { TRAMPOLINE: 0, RAMP: 1, BOOST: 2, DOME: 3, RING: 4 } as const;
export type ObType = (typeof OB)[keyof typeof OB];

const TILE = 340;        // metres; field repeats every TILE in x and z

// collision radius + base scale per type (RING has no collision)
const RADIUS = [2.6, 3.2, 2.4, 2.4, 0];

export interface Ob {
  type: ObType;
  lx: number; lz: number;   // local position inside the tile
  yaw: number;
  scale: number;
  pulse: number;            // 0..1 hit animation (squash / flash), decays
  cx: number; cz: number;   // cached world position nearest the player (this frame)
}

export interface Hit { ob: Ob; dist: number; }

const dummy = new THREE.Object3D();

export class Obstacles {
  group = new THREE.Group();
  private byType: Ob[][] = [[], [], [], [], []];
  private meshes: THREE.InstancedMesh[][] = [[], [], [], [], []];
  private mats: THREE.Material[] = [];
  private density = 1;

  constructor(rng: RNG) {
    const counts = [18, 14, 12, 16, 9]; // tramp, ramp, boost, dome, ring
    for (let t = 0; t < 5; t++) {
      for (let i = 0; i < counts[t]; i++) {
        this.byType[t].push({
          type: t as ObType,
          lx: rng.range(0, TILE),
          lz: rng.range(0, TILE),
          yaw: rng.range(0, Math.PI * 2),
          scale: rng.range(0.85, 1.3),
          pulse: 0, cx: 0, cz: 0,
        });
      }
    }
    this.buildMeshes();
  }

  // ---- geometry / materials -------------------------------------------------
  private buildMeshes(): void {
    // TRAMPOLINE = dark frame ring + bright bouncy mat (two instanced meshes,
    // same per-instance transform; the mat squashes on hit).
    const frame = new THREE.TorusGeometry(2.5, 0.32, 8, 20);
    frame.rotateX(Math.PI / 2);
    frame.translate(0, 0.55, 0);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x222932, roughness: 0.7, metalness: 0.3 });
    const mat = new THREE.CircleGeometry(2.4, 22);
    mat.rotateX(-Math.PI / 2);
    mat.translate(0, 0.5, 0);
    const matMat = new THREE.MeshStandardMaterial({
      color: 0xff3b6b, emissive: 0xff3b6b, emissiveIntensity: 0.35, roughness: 0.5, metalness: 0,
      side: THREE.DoubleSide,
    });
    this.addType(OB.TRAMPOLINE, [frame, mat], [frameMat, matMat]);

    // RAMP = triangular-prism kicker, low end facing the approach.
    const ramp = makeWedge(4, 6, 2.4);
    const rampMat = new THREE.MeshStandardMaterial({ color: 0xe8a13a, roughness: 0.85, metalness: 0.05 });
    this.addType(OB.RAMP, [ramp], [rampMat]);

    // BOOST = thin glowing pad.
    const pad = new THREE.BoxGeometry(4.2, 0.18, 7);
    pad.translate(0, 0.09, 0);
    const padMat = new THREE.MeshStandardMaterial({
      color: 0x0a3a44, emissive: 0x16e0ff, emissiveIntensity: 1.1, roughness: 0.4, metalness: 0.1,
    });
    this.addType(OB.BOOST, [pad], [padMat]);

    // DOME = soft bounce hemisphere.
    const dome = new THREE.SphereGeometry(2.3, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    const domeMat = new THREE.MeshStandardMaterial({ color: 0x7d56c9, roughness: 0.6, metalness: 0.1 });
    this.addType(OB.DOME, [dome], [domeMat]);

    // RING = vertical torus you can drive through (cosmetic flair).
    const ring = new THREE.TorusGeometry(4, 0.42, 10, 28);
    ring.translate(0, 4, 0);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x111417, emissive: 0x3ad0ff, emissiveIntensity: 0.9, roughness: 0.4, metalness: 0.4,
    });
    this.addType(OB.RING, [ring], [ringMat]);
  }

  private addType(t: ObType, geos: THREE.BufferGeometry[], mats: THREE.Material[]): void {
    const n = this.byType[t].length;
    geos.forEach((g, gi) => {
      const m = mats[gi];
      this.mats.push(m);
      const im = new THREE.InstancedMesh(g, m, n);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.castShadow = t !== OB.BOOST;
      im.receiveShadow = true;
      im.frustumCulled = false;
      this.meshes[t].push(im);
      this.group.add(im);
    });
  }

  // ---- per-frame ------------------------------------------------------------
  /** Recompute each obstacle's nearest world copy around the player + matrices. */
  update(px: number, pz: number, dt: number): void {
    for (let t = 0; t < 5; t++) {
      const list = this.byType[t];
      const visible = Math.max(1, Math.floor(list.length * this.density));
      const meshes = this.meshes[t];
      for (let i = 0; i < list.length; i++) {
        const ob = list[i];
        if (ob.pulse > 0) ob.pulse = Math.max(0, ob.pulse - dt * 2.6);
        // nearest toroidal copy of this obstacle to the player
        ob.cx = ob.lx + TILE * Math.round((px - ob.lx) / TILE);
        ob.cz = ob.lz + TILE * Math.round((pz - ob.lz) / TILE);

        if (i >= visible) { hide(meshes, i); continue; }

        dummy.position.set(ob.cx, 0, ob.cz);
        dummy.rotation.set(0, ob.yaw, 0);
        const squash = t === OB.TRAMPOLINE || t === OB.DOME ? 1 - ob.pulse * 0.45 : 1;
        dummy.scale.set(ob.scale, ob.scale * squash, ob.scale);
        dummy.updateMatrix();
        for (const im of meshes) im.setMatrixAt(i, dummy.matrix);
      }
      for (const im of meshes) im.instanceMatrix.needsUpdate = true;
    }
  }

  /** Closest colliding obstacle the car is currently over, or null. */
  sample(x: number, z: number): Hit | null {
    let best: Hit | null = null;
    for (let t = 0; t < 5; t++) {
      const r = RADIUS[t];
      if (r <= 0) continue;
      const visible = Math.max(1, Math.floor(this.byType[t].length * this.density));
      for (let i = 0; i < visible; i++) {
        const ob = this.byType[t][i];
        const dx = x - ob.cx, dz = z - ob.cz;
        const d = Math.hypot(dx, dz);
        const rr = r * ob.scale;
        if (d < rr && (!best || d < best.dist)) best = { ob, dist: d };
      }
    }
    return best;
  }

  setDensity(d: number): void { this.density = THREE.MathUtils.clamp(d, 0.2, 1); }

  /** Brighten emissive accents a touch at night. */
  setNight(n: number): void {
    for (const m of this.mats) {
      const sm = m as THREE.MeshStandardMaterial;
      if (sm.emissiveIntensity === undefined) continue;
      if (sm.emissive && (sm.emissive.r + sm.emissive.g + sm.emissive.b) > 0.2) {
        sm.emissiveIntensity = 0.7 + n * 0.9;
      }
    }
  }

  dispose(): void {
    for (const row of this.meshes) for (const im of row) im.geometry.dispose();
    for (const m of this.mats) m.dispose();
  }
}

function hide(meshes: THREE.InstancedMesh[], i: number): void {
  dummy.position.set(0, -9999, 0);
  dummy.rotation.set(0, 0, 0);
  dummy.scale.set(1, 1, 1);
  dummy.updateMatrix();
  for (const im of meshes) im.setMatrixAt(i, dummy.matrix);
}

/** A triangular-prism ramp: low edge at -z, rising to height h at +z. */
function makeWedge(w: number, len: number, h: number): THREE.BufferGeometry {
  const hw = w / 2, hl = len / 2;
  // A=lowL B=lowR (z=-hl,y=0)  C=backR D=backL (z=+hl,y=0)  E=topL F=topR (z=+hl,y=h)
  const A = [-hw, 0, -hl], B = [hw, 0, -hl], C = [hw, 0, hl], D = [-hw, 0, hl];
  const E = [-hw, h, hl], F = [hw, h, hl];
  const tris = [
    A, B, F, A, F, E,   // sloped top
    D, C, B, D, B, A,   // bottom
    D, F, C, D, E, F,   // vertical back
    A, E, D,            // left
    B, C, F,            // right
  ];
  const pos = new Float32Array(tris.length * 3);
  tris.forEach((v, i) => { pos[i * 3] = v[0]; pos[i * 3 + 1] = v[1]; pos[i * 3 + 2] = v[2]; });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
