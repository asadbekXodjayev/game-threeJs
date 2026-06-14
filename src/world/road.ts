import * as THREE from 'three';
import { makeRoadTexture, makeGroundTexture } from './textures';

/**
 * Chunk-based pooled road. The world scrolls toward -Z as the car "drives";
 * each tile is a flat segment. Gentle lateral curvature is a function of
 * absolute distance, sampled so the road bends smoothly. Tiles behind the
 * camera are recycled to the front — never created/destroyed in the loop.
 * (isEndless + isPooled + isProcedural)
 */

export const ROAD_WIDTH = 14; // 4 lanes-ish
export const LANE_OFFSET = 3.4; // half-distance between the two drivable lanes
const TILE_LEN = 20;
const TILE_COUNT = 24; // covers ~480m of view
const GROUND_WIDTH = 420;

export class Road {
  group = new THREE.Group();
  roadMat: THREE.MeshStandardMaterial;
  groundMat: THREE.MeshStandardMaterial;
  private roadTiles: THREE.Mesh[] = [];
  private groundTiles: THREE.Mesh[] = [];
  private headZ = 0; // furthest tile front edge (negative = ahead)

  /** smooth procedural curvature seed offset */
  private curveSeed: number;

  constructor(curveSeed: number) {
    this.curveSeed = curveSeed;

    const roadTex = makeRoadTexture();
    roadTex.repeat.set(1, TILE_LEN / 10);
    this.roadMat = new THREE.MeshStandardMaterial({
      map: roadTex,
      roughness: 0.92,
      metalness: 0.0,
    });
    const groundTex = makeGroundTexture();
    this.groundMat = new THREE.MeshStandardMaterial({
      map: groundTex,
      color: 0x4d6b3f,
      roughness: 1,
      metalness: 0,
    });

    const roadGeo = new THREE.PlaneGeometry(ROAD_WIDTH, TILE_LEN, 1, 1);
    roadGeo.rotateX(-Math.PI / 2);
    const groundGeo = new THREE.PlaneGeometry(GROUND_WIDTH, TILE_LEN, 1, 1);
    groundGeo.rotateX(-Math.PI / 2);

    for (let i = 0; i < TILE_COUNT; i++) {
      const g = new THREE.Mesh(groundGeo, this.groundMat);
      g.receiveShadow = true;
      g.position.y = -0.02;
      this.group.add(g);
      this.groundTiles.push(g);

      const r = new THREE.Mesh(roadGeo, this.roadMat);
      r.receiveShadow = true;
      this.group.add(r);
      this.roadTiles.push(r);
    }
    this.layout();
  }

  /** Lateral center of the road at a given world distance (meters travelled). */
  curveX(dist: number): number {
    const s = dist * 0.0016 + this.curveSeed;
    return Math.sin(s) * 16 + Math.sin(s * 0.37 + 1.3) * 9;
  }

  /** initial placement of all tiles ahead of the car */
  private layout(): void {
    for (let i = 0; i < TILE_COUNT; i++) {
      this.placeTile(i, -i * TILE_LEN);
    }
    this.headZ = -(TILE_COUNT - 1) * TILE_LEN;
  }

  private placeTile(i: number, z: number, dist = 0): void {
    const x = this.curveX(dist - z);
    const r = this.roadTiles[i];
    const g = this.groundTiles[i];
    r.position.set(x, 0, z);
    g.position.set(x * 0.5, -0.02, z);
  }

  /**
   * Scroll the world. `delta` = meters the car advanced this frame (>0).
   * Recycles tiles that fall behind the camera to the front of the queue.
   */
  update(delta: number, totalDist: number): void {
    for (const r of this.roadTiles) r.position.z += delta;
    for (const g of this.groundTiles) g.position.z += delta;

    // recycle any tile that's gone well behind the camera (camera ~ z=10)
    for (let i = 0; i < TILE_COUNT; i++) {
      const r = this.roadTiles[i];
      if (r.position.z > 40) {
        // move to the front
        this.headZ -= TILE_LEN;
        const z = this.headZ;
        // distance value for curvature at that tile's leading position
        const aheadDist = totalDist + (-z) ;
        const x = this.curveX(aheadDist);
        r.position.set(x, 0, z);
        const g = this.groundTiles[i];
        g.position.set(x * 0.5, -0.02, z);
      }
    }
  }

  setColors(road: THREE.Color, ground: THREE.Color): void {
    this.roadMat.color.copy(road);
    this.groundMat.color.copy(ground);
  }

  dispose(): void {
    this.roadMat.map?.dispose();
    this.roadMat.dispose();
    this.groundMat.map?.dispose();
    this.groundMat.dispose();
    this.roadTiles[0]?.geometry.dispose();
    this.groundTiles[0]?.geometry.dispose();
  }
}
