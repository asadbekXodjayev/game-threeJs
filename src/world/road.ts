import * as THREE from 'three';
import { makeRoadTexture } from './textures';

/**
 * CONTINUOUS spline ribbon road (rebuilt P0).
 *
 * Previous bug: the road was a set of axis-aligned flat PlaneGeometry tiles that
 * only scrolled on Z while their X was offset by curveX(dist). Because each tile
 * stayed a rigid rectangle (never rotated to follow the curve) and never shared
 * its end edge with the next tile's start edge, increasing curvature pulled
 * adjacent tile centres apart in X — leaving wedge GAPS and "floating" road
 * pieces in the distance, plus the ground used a different curve (x*0.5) so it
 * separated too.
 *
 * Fix: one long ribbon mesh whose vertices are sampled along the SAME procedural
 * spline. Every cross-section is built from the centerline + its perpendicular,
 * so the left/right edges of consecutive segments are shared (vertex-continuous)
 * — there is no gap at any distance and the strip banks/curves as one surface.
 * Each frame we re-sample the spline at (totalDist + arc) so the ribbon scrolls
 * like a treadmill; vertices are recycled, never created/destroyed. The ground,
 * shoulders and lane markings are sampled from the identical centerline so they
 * follow the curve exactly. (isEndless + isPooled + isProcedural)
 */

export const ROAD_WIDTH = 14; // 4 lanes-ish
export const LANE_OFFSET = 3.4; // half-distance between the two drivable lanes
const HALF = ROAD_WIDTH / 2;

// ribbon sampling
const SEG_LEN = 6; // metres between cross-sections (smaller = smoother curve)
const AHEAD = 460; // metres of road in front of the car
const BEHIND = 60; // metres kept behind for the recycle margin
const SEGS = Math.ceil((AHEAD + BEHIND) / SEG_LEN);
const GROUND_HALF = 240;

export class Road {
  group = new THREE.Group();
  roadMat: THREE.MeshStandardMaterial;
  groundMat: THREE.MeshStandardMaterial;
  markMat: THREE.MeshBasicMaterial;

  private roadGeo: THREE.BufferGeometry;
  private groundGeo: THREE.BufferGeometry;
  private markGeo: THREE.BufferGeometry;
  private roadPos: Float32Array;
  private groundPos: Float32Array;
  private markPos: Float32Array;

  private curveSeed: number;

  constructor(curveSeed: number) {
    this.curveSeed = curveSeed;

    const roadTex = makeRoadTexture();
    roadTex.repeat.set(1, 6);
    this.roadMat = new THREE.MeshStandardMaterial({
      map: roadTex,
      roughness: 0.92,
      metalness: 0.0,
    });
    this.groundMat = new THREE.MeshStandardMaterial({
      color: 0x4d6b3f,
      roughness: 1,
      metalness: 0,
    });
    this.markMat = new THREE.MeshBasicMaterial({ color: 0xf2d65a, transparent: true, opacity: 0.92 });

    // --- road ribbon: 2 verts per cross-section, triangle strip via indices ---
    this.roadGeo = new THREE.BufferGeometry();
    this.roadPos = new Float32Array((SEGS + 1) * 2 * 3);
    const ruv = new Float32Array((SEGS + 1) * 2 * 2);
    const rIdx: number[] = [];
    for (let i = 0; i <= SEGS; i++) {
      ruv[(i * 2) * 2] = 0; ruv[(i * 2) * 2 + 1] = i;
      ruv[(i * 2 + 1) * 2] = 1; ruv[(i * 2 + 1) * 2 + 1] = i;
      if (i < SEGS) {
        const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
        // wind so the surface normal points UP (+Y)
        rIdx.push(a, b, c, b, d, c);
      }
    }
    this.roadGeo.setAttribute('position', new THREE.BufferAttribute(this.roadPos, 3));
    this.roadGeo.setAttribute('uv', new THREE.BufferAttribute(ruv, 2));
    this.roadGeo.setIndex(rIdx);

    // --- ground ribbon (wide flat strip following the same spine) ---
    this.groundGeo = new THREE.BufferGeometry();
    this.groundPos = new Float32Array((SEGS + 1) * 2 * 3);
    const gIdx: number[] = [];
    for (let i = 0; i < SEGS; i++) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      gIdx.push(a, b, c, b, d, c);
    }
    this.groundGeo.setAttribute('position', new THREE.BufferAttribute(this.groundPos, 3));
    this.groundGeo.setIndex(gIdx);

    // --- lane markings: 2 dashed center dividers, built as small quads ---
    // we draw the two lane dividers as a thin ribbon each, dashed via UV/opacity baked into geometry skips.
    const markVerts = (SEGS + 1) * 4 * 3; // 2 dividers * 2 verts
    this.markGeo = new THREE.BufferGeometry();
    this.markPos = new Float32Array(markVerts);
    const mIdx: number[] = [];
    for (let d = 0; d < 2; d++) {
      const base = d * (SEGS + 1) * 2;
      for (let i = 0; i < SEGS; i++) {
        if (i % 2 === 1) continue; // dash gap (every other segment)
        const a = base + i * 2, b = base + i * 2 + 1, c = base + (i + 1) * 2, dd = base + (i + 1) * 2 + 1;
        mIdx.push(a, b, c, b, dd, c);
      }
    }
    this.markGeo.setAttribute('position', new THREE.BufferAttribute(this.markPos, 3));
    this.markGeo.setIndex(mIdx);

    const groundMesh = new THREE.Mesh(this.groundGeo, this.groundMat);
    groundMesh.receiveShadow = true;
    groundMesh.frustumCulled = false;
    this.group.add(groundMesh);

    const roadMesh = new THREE.Mesh(this.roadGeo, this.roadMat);
    roadMesh.receiveShadow = true;
    roadMesh.frustumCulled = false;
    this.group.add(roadMesh);

    const markMesh = new THREE.Mesh(this.markGeo, this.markMat);
    markMesh.frustumCulled = false;
    markMesh.position.y = 0.015;
    this.group.add(markMesh);

    this.rebuild(0);
  }

  /** Lateral center of the road at a given world distance (metres travelled). */
  curveX(dist: number): number {
    const s = dist * 0.0016 + this.curveSeed;
    // chill sweeping S-curves: slow base + a secondary, with a slow envelope
    return Math.sin(s) * 18 + Math.sin(s * 0.37 + 1.3) * 11 + Math.sin(s * 0.13 + 4.0) * 6;
  }

  /** banking (roll) of the road at a given distance — gentle, follows curvature */
  private bankAt(dist: number): number {
    // derivative of curveX approximates lateral slope -> bank into the curve
    const d1 = this.curveX(dist + 1) - this.curveX(dist - 1);
    return THREE.MathUtils.clamp(-d1 * 0.06, -0.12, 0.12);
  }

  /** tangent heading (yaw) of the centerline at a distance, for car/props facing */
  headingAt(dist: number): number {
    const d1 = this.curveX(dist + 2) - this.curveX(dist - 2);
    return Math.atan2(d1, 4);
  }

  /**
   * Re-sample the whole ribbon for the current travelled distance. Vertices are
   * reused; this is the treadmill scroll — O(SEGS) per frame, no allocation.
   */
  private rebuild(totalDist: number): void {
    const up = new THREE.Vector3(0, 1, 0);
    const tan = new THREE.Vector3();
    const perp = new THREE.Vector3();
    for (let i = 0; i <= SEGS; i++) {
      // z runs from +BEHIND (behind car) to -AHEAD (ahead). car is at z=0.
      const z = BEHIND - i * SEG_LEN;
      const dist = totalDist - z; // distance value used by curveX (z negative ahead)
      const cx = this.curveX(dist);
      const bank = this.bankAt(dist);

      // tangent in world space (dx/dz). Going forward = -z, so use neighbour.
      const cxAhead = this.curveX(dist + SEG_LEN);
      tan.set(cxAhead - cx, 0, -SEG_LEN).normalize();
      // perpendicular (right vector) = tan x up
      perp.crossVectors(tan, up).normalize();
      // banking tilts the cross section: raise the outer edge a touch
      const yL = -perp.x * bank * HALF; // left edge lift
      const yR = perp.x * bank * HALF;

      const li = (i * 2) * 3;
      const ri = (i * 2 + 1) * 3;
      // road edges
      this.roadPos[li] = cx - perp.x * HALF;
      this.roadPos[li + 1] = 0.01 + yL;
      this.roadPos[li + 2] = z;
      this.roadPos[ri] = cx + perp.x * HALF;
      this.roadPos[ri + 1] = 0.01 + yR;
      this.roadPos[ri + 2] = z;

      // ground edges (wide, same spine so it never separates from the road)
      this.groundPos[li] = cx - perp.x * GROUND_HALF;
      this.groundPos[li + 1] = -0.04;
      this.groundPos[li + 2] = z;
      this.groundPos[ri] = cx + perp.x * GROUND_HALF;
      this.groundPos[ri + 1] = -0.04;
      this.groundPos[ri + 2] = z;

      // lane dividers at +/- LANE_OFFSET, each a thin quad
      const w = 0.18;
      for (let d = 0; d < 2; d++) {
        const lane = (d === 0 ? -LANE_OFFSET : LANE_OFFSET);
        const base = d * (SEGS + 1) * 2;
        const mli = (base + i * 2) * 3;
        const mri = (base + i * 2 + 1) * 3;
        const mx = cx + perp.x * lane;
        const mz = z; // perp.z ~ small; keep on z line for simplicity
        this.markPos[mli] = mx - perp.x * w; this.markPos[mli + 1] = 0; this.markPos[mli + 2] = mz - perp.z * lane;
        this.markPos[mri] = mx + perp.x * w; this.markPos[mri + 1] = 0; this.markPos[mri + 2] = mz - perp.z * lane;
      }
    }
    this.roadGeo.attributes.position.needsUpdate = true;
    this.groundGeo.attributes.position.needsUpdate = true;
    this.markGeo.attributes.position.needsUpdate = true;
    this.roadGeo.computeVertexNormals();
    this.groundGeo.computeVertexNormals();
  }

  /** Scroll the world. `delta` (metres advanced) kept for API compat. */
  update(delta: number, totalDist: number): void {
    void delta;
    this.rebuild(totalDist);
  }

  setColors(road: THREE.Color, ground: THREE.Color): void {
    this.roadMat.color.copy(road);
    this.groundMat.color.copy(ground);
  }

  dispose(): void {
    this.roadMat.map?.dispose();
    this.roadMat.dispose();
    this.groundMat.dispose();
    this.markMat.dispose();
    this.roadGeo.dispose();
    this.groundGeo.dispose();
    this.markGeo.dispose();
  }
}
