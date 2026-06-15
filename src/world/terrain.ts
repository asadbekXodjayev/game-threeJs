import * as THREE from 'three';

/**
 * Distant PARALLAX terrain — layered rolling-hill / mountain silhouettes on the
 * horizon that drift past as you travel, so forward motion reads as real travel
 * instead of a treadmill. Three depth bands (near hills -> far mountains) each
 * scroll at a fraction of world speed (classic parallax). Each band is a long
 * horizontal strip of seeded noise hills, rebuilt as a scrolling buffer (no
 * allocation per frame) and biome-tinted. Cheap: 3 thin meshes, basic material,
 * no lighting/shadows. (isPooled + isProcedural + isEndless)
 */

interface Band {
  mesh: THREE.Mesh;
  pos: Float32Array;
  geo: THREE.BufferGeometry;
  mat: THREE.MeshBasicMaterial;
  baseColor: THREE.Color;
  parallax: number; // 0..1 fraction of world scroll
  depth: number; // world Z of the band (negative = far)
  height: number; // peak amplitude
  freq: number; // hill frequency
  span: number; // total world-X width covered
}

const COLUMNS = 80; // silhouette resolution per band

export class Terrain {
  group = new THREE.Group();
  private bands: Band[] = [];
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
    // far -> near: mountains are tallest/slowest, foothills nearest/fastest
    this.bands.push(this.makeBand({ depth: -600, height: 120, freq: 0.012, parallax: 0.08, color: 0x6a7a92, span: 2400 }));
    this.bands.push(this.makeBand({ depth: -440, height: 78, freq: 0.02, parallax: 0.16, color: 0x5d7280, span: 2000 }));
    this.bands.push(this.makeBand({ depth: -300, height: 44, freq: 0.034, parallax: 0.3, color: 0x4f6b54, span: 1600 }));
    this.group.renderOrder = -1;
  }

  private noiseH(x: number, freq: number, height: number): number {
    const s = x * freq + this.seed;
    return (
      (Math.sin(s) * 0.6 + Math.sin(s * 2.3 + 1.7) * 0.28 + Math.sin(s * 5.1 + 4.0) * 0.12) * 0.5 + 0.5
    ) * height;
  }

  private makeBand(o: { depth: number; height: number; freq: number; parallax: number; color: number; span: number }): Band {
    const geo = new THREE.BufferGeometry();
    // a triangle strip: top vertex (hill) + bottom vertex (floor) per column
    const pos = new Float32Array((COLUMNS + 1) * 2 * 3);
    const idx: number[] = [];
    for (let i = 0; i < COLUMNS; i++) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      idx.push(a, b, c, b, d, c);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({ color: o.color, fog: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return {
      mesh, pos, geo, mat, baseColor: new THREE.Color(o.color),
      parallax: o.parallax, depth: o.depth, height: o.height, freq: o.freq, span: o.span,
    };
  }

  /**
   * @param totalDist world distance travelled — drives parallax scroll.
   * @param centerX   current road centre X so bands stay ahead of the camera.
   * @param tint      biome ground colour to tint the silhouettes toward.
   * @param night     0..1 darkens the hills at night.
   */
  update(totalDist: number, centerX: number, tint: THREE.Color, night = 0): void {
    for (const band of this.bands) {
      const off = totalDist * band.parallax; // how far this band has slid
      const half = band.span / 2;
      const step = band.span / COLUMNS;
      for (let i = 0; i <= COLUMNS; i++) {
        const localX = -half + i * step;
        const worldX = centerX + localX;
        // sample noise at a world coordinate that advances with travel
        const h = this.noiseH(localX + off, band.freq, band.height);
        const li = (i * 2) * 3;
        const bi = (i * 2 + 1) * 3;
        band.pos[li] = worldX; band.pos[li + 1] = h - 8; band.pos[li + 2] = band.depth;
        band.pos[bi] = worldX; band.pos[bi + 1] = -40; band.pos[bi + 2] = band.depth;
      }
      band.geo.attributes.position.needsUpdate = true;
      // tint toward the biome ground colour, darken at night
      band.mat.color.copy(band.baseColor).lerp(tint, 0.35).multiplyScalar(1 - night * 0.7);
    }
  }

  dispose(): void {
    for (const b of this.bands) { b.geo.dispose(); b.mat.dispose(); }
  }
}
