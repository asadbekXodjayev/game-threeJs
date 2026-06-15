import * as THREE from 'three';
import { makeRoadTexture } from './textures';

/**
 * CONTINUOUS spline ribbon road (rebuilt P0; elevated + bidirectional P2).
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
 * like a treadmill; vertices are recycled, never created/destroyed.
 *
 * P2 "real travel" upgrade (kills the treadmill feel):
 *  - curveY(): seeded multi-octave noise on the Y axis -> rolling HILLS and DIPS.
 *    The car pitches with slopeAt(); over a crest the camera briefly loses the
 *    road as it dips away. Ground + road + markings share the SAME height.
 *  - curveX(): seeded sum-of-sines tuned to swing BOTH ways (no constant drift),
 *    with random per-octave phase so left/right bends alternate unpredictably.
 *  - heightAt()/slopeAt() are read by main.ts (car height + pitch) and by every
 *    scatter/prop/traffic system so the whole world sits on the terrain surface.
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
  // per-cross-section frame cache (centre + perpendicular) reused each rebuild so
  // the world-anchored lane dashes can span consecutive cross-sections.
  private frameCx: Float32Array;
  private frameCy: Float32Array;
  private framePx: Float32Array;
  private framePz: Float32Array;

  private curveSeed: number;
  // seeded random phases so each playthrough bends left/right differently
  private px: number[] = [];
  private py: number[] = [];

  constructor(curveSeed: number) {
    this.curveSeed = curveSeed;
    // deterministic phase table from the seed (simple LCG, no extra deps)
    let s = (curveSeed * 9973 + 12345) >>> 0;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < 8; i++) { this.px.push(rnd() * Math.PI * 2); this.py.push(rnd() * Math.PI * 2); }

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

    // --- lane markings: 2 dashed center dividers ---
    // Each dash is an INDEPENDENT quad (own 4 verts, no sharing) so any single
    // dash can be collapsed to zero area per frame. Whether a quad is drawn is
    // keyed to WORLD distance (not the screen-fixed segment index), so the dashes
    // stay anchored in world space and flow past the car instead of looking glued
    // to the camera. Index is full (all quads) and built once.
    this.frameCx = new Float32Array(SEGS + 1);
    this.frameCy = new Float32Array(SEGS + 1);
    this.framePx = new Float32Array(SEGS + 1);
    this.framePz = new Float32Array(SEGS + 1);
    const markVerts = 2 * SEGS * 4 * 3; // 2 dividers * SEGS quads * 4 verts
    this.markGeo = new THREE.BufferGeometry();
    this.markPos = new Float32Array(markVerts);
    const mIdx: number[] = [];
    for (let d = 0; d < 2; d++) {
      for (let i = 0; i < SEGS; i++) {
        const base = (d * SEGS + i) * 4; // 0=startL 1=startR 2=endL 3=endR
        mIdx.push(base + 0, base + 1, base + 2, base + 1, base + 3, base + 2);
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

  /**
   * Lateral center of the road at a given world distance (metres travelled).
   * Sum-of-sines with seeded phases so the road swings BOTH left and right with
   * varying strength — no constant one-way drift. The big slow term sets the
   * dominant sweep; faster terms add genuine alternating L/R kinks.
   */
  curveX(dist: number): number {
    const s = dist * 0.0021 + this.curveSeed;
    return (
      Math.sin(s + this.px[0]) * 24 +
      Math.sin(s * 0.41 + this.px[1]) * 15 +
      Math.sin(s * 0.19 + this.px[2]) * 9 +
      Math.sin(s * 1.05 + this.px[3]) * 7 +
      // faster, smaller terms add genuine alternating L/R kinks whose tangent is
      // steep enough to read as a clear bend (not just a long lazy sweep)
      Math.sin(s * 2.6 + this.px[4]) * 8 +
      Math.sin(s * 4.1 + this.px[5]) * 4
    );
  }

  /**
   * Vertical elevation (Y) of the centerline at a distance — seeded rolling
   * hills and dips. Multi-octave so you get long valleys with smaller rises on
   * top. Amplitude is generous enough that you crest a hill and lose sight of
   * the road dipping away beyond it.
   */
  curveY(dist: number): number {
    // shorter wavelengths than the lateral curve so crests are steep enough to
    // actually lose the road over them (you crest a rise, road dips away).
    const s = dist * 0.009 + this.curveSeed * 0.7;
    return (
      Math.sin(s + this.py[0]) * 7.5 +
      Math.sin(s * 0.45 + this.py[1]) * 5.0 +
      Math.sin(s * 2.3 + this.py[2]) * 2.0
    );
  }

  /** banking (roll) of the road at a given distance — gentle, follows curvature */
  private bankAt(dist: number): number {
    const d1 = this.curveX(dist + 1) - this.curveX(dist - 1);
    return THREE.MathUtils.clamp(-d1 * 0.06, -0.12, 0.12);
  }

  /** tangent heading (yaw) of the centerline at a distance, for car/props facing */
  headingAt(dist: number): number {
    const d1 = this.curveX(dist + 2) - this.curveX(dist - 2);
    return Math.atan2(d1, 4);
  }

  /** terrain height at a distance — what the car/props sit on. */
  heightAt(dist: number): number { return this.curveY(dist); }

  /** longitudinal slope (pitch) of the road at a distance: rise over run. */
  slopeAt(dist: number): number {
    const dy = this.curveY(dist + 3) - this.curveY(dist - 3);
    return Math.atan2(dy, 6);
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
      const cy = this.curveY(dist);
      const bank = this.bankAt(dist);

      // tangent in world space (dx/dz, dy/dz). Going forward = -z.
      const cxAhead = this.curveX(dist + SEG_LEN);
      const cyAhead = this.curveY(dist + SEG_LEN);
      tan.set(cxAhead - cx, cyAhead - cy, -SEG_LEN).normalize();
      // perpendicular (right vector) = tan x up
      perp.crossVectors(tan, up).normalize();
      // banking tilts the cross section: raise the outer edge a touch
      const yL = -perp.x * bank * HALF; // left edge lift
      const yR = perp.x * bank * HALF;

      const li = (i * 2) * 3;
      const ri = (i * 2 + 1) * 3;
      // road edges (sit on the elevated centerline)
      this.roadPos[li] = cx - perp.x * HALF;
      this.roadPos[li + 1] = cy + 0.01 + yL;
      this.roadPos[li + 2] = z;
      this.roadPos[ri] = cx + perp.x * HALF;
      this.roadPos[ri + 1] = cy + 0.01 + yR;
      this.roadPos[ri + 2] = z;

      // ground edges (wide, same spine + height so it never separates)
      this.groundPos[li] = cx - perp.x * GROUND_HALF;
      this.groundPos[li + 1] = cy - 0.04;
      this.groundPos[li + 2] = z;
      this.groundPos[ri] = cx + perp.x * GROUND_HALF;
      this.groundPos[ri + 1] = cy - 0.04;
      this.groundPos[ri + 2] = z;

      // cache this cross-section's frame so the lane dashes (built below) can
      // span from cross-section i to i+1 using consistent centre + perpendicular.
      this.frameCx[i] = cx;
      this.frameCy[i] = cy;
      this.framePx[i] = perp.x;
      this.framePz[i] = perp.z;
    }

    // --- world-anchored dashed lane dividers --------------------------------
    // A dash occupies one SEG_LEN of WORLD distance, then a gap of one. The
    // on/off test reads the absolute distance of each segment, so the pattern is
    // fixed in the world: as totalDist grows the dashes scroll toward (and past)
    // the car. Off-segments collapse to a point (zero area) — invisible, no alloc.
    const w = 0.18;
    for (let d = 0; d < 2; d++) {
      const lane = (d === 0 ? -LANE_OFFSET : LANE_OFFSET);
      for (let i = 0; i < SEGS; i++) {
        const base = (d * SEGS + i) * 4 * 3;
        const zStart = BEHIND - i * SEG_LEN;
        const distStart = totalDist - zStart;
        // dash when the world-distance band is "on" (1 seg on, 1 seg off)
        const on = (((Math.floor(distStart / SEG_LEN) % 2) + 2) % 2) === 0;
        if (!on) {
          for (let v = 0; v < 4; v++) { this.markPos[base + v * 3] = 0; this.markPos[base + v * 3 + 1] = -9999; this.markPos[base + v * 3 + 2] = 0; }
          continue;
        }
        const zS = BEHIND - i * SEG_LEN;
        const zE = BEHIND - (i + 1) * SEG_LEN;
        const sx = this.frameCx[i] + this.framePx[i] * lane;
        const ex = this.frameCx[i + 1] + this.framePx[i + 1] * lane;
        const sy = this.frameCy[i], ey = this.frameCy[i + 1];
        const spx = this.framePx[i], epx = this.framePx[i + 1];
        const szc = zS - this.framePz[i] * lane;
        const ezc = zE - this.framePz[i + 1] * lane;
        // startL, startR, endL, endR (thin width along the perpendicular)
        this.markPos[base + 0] = sx - spx * w; this.markPos[base + 1] = sy; this.markPos[base + 2] = szc;
        this.markPos[base + 3] = sx + spx * w; this.markPos[base + 4] = sy; this.markPos[base + 5] = szc;
        this.markPos[base + 6] = ex - epx * w; this.markPos[base + 7] = ey; this.markPos[base + 8] = ezc;
        this.markPos[base + 9] = ex + epx * w; this.markPos[base + 10] = ey; this.markPos[base + 11] = ezc;
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
