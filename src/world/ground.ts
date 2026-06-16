import * as THREE from 'three';
import { makeOpenGroundTexture } from './textures';

/**
 * Infinite open-world floor. ONE big plane wearing ONE canvas texture
 * (makeOpenGroundTexture). The plane is recentred on the car every frame and the
 * texture offset is scrolled by the car's world position, so the pattern stays
 * pinned in world space while the mesh follows you — you can drive forever in any
 * direction and the ground never ends and never pops. Single draw call, no
 * per-frame geometry work: this is the cheap replacement for the old scrolling
 * ribbon road + terrain + scatter stack.
 */
const PLANE = 2400;      // metres across (huge; far side lost to fog)
const TILE = 11;         // metres per texture tile
const REPEAT = PLANE / TILE;

export class Ground {
  group = new THREE.Group();
  mat: THREE.MeshStandardMaterial;
  private tex: THREE.Texture;
  private mesh: THREE.Mesh;

  constructor() {
    this.tex = makeOpenGroundTexture();
    this.tex.repeat.set(REPEAT, REPEAT);
    this.mat = new THREE.MeshStandardMaterial({
      map: this.tex,
      roughness: 0.96,
      metalness: 0,
    });
    const geo = new THREE.PlaneGeometry(PLANE, PLANE, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
  }

  /** Recentre on the car and scroll the texture so the floor reads as infinite. */
  update(carX: number, carZ: number): void {
    this.mesh.position.set(carX, 0, carZ);
    // texture space: 1 unit = one tile. Scroll by world position / tile size.
    this.tex.offset.set(carX / TILE, -carZ / TILE);
  }

  /** Day/night brightness multiply on the floor (keeps the canvas hue, dims it). */
  setBrightness(b: number): void {
    this.mat.color.setScalar(b);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.tex.dispose();
    this.mat.dispose();
  }
}
