import * as THREE from 'three';
import { makeCloudTexture } from './textures';

/**
 * Soft billboard clouds drifting high over the open world. A pool of large
 * camera-facing sprites kept in a box around the player (they wrap when they
 * fall behind the wind), tinted from bright white by day to a moody grey at
 * night and thickened when stormy. Cheap: a few dozen transparent sprites.
 */
const SPREAD = 600;   // horizontal box half-size around the player
const Y_MIN = 70, Y_MAX = 150;

export class Clouds {
  group = new THREE.Group();
  private tex: THREE.Texture;
  private sprites: THREE.Sprite[] = [];
  private wind = new THREE.Vector2(6, 2); // m/s drift

  constructor(count = 22) {
    this.tex = makeCloudTexture();
    for (let i = 0; i < count; i++) {
      const m = new THREE.SpriteMaterial({
        map: this.tex, color: 0xffffff, transparent: true, opacity: 0.78,
        depthWrite: false, fog: false,
      });
      const s = new THREE.Sprite(m);
      const scl = 90 + Math.random() * 140;
      s.scale.set(scl, scl * 0.62, 1);
      s.position.set(
        (Math.random() - 0.5) * SPREAD * 2,
        Y_MIN + Math.random() * (Y_MAX - Y_MIN),
        (Math.random() - 0.5) * SPREAD * 2,
      );
      s.frustumCulled = false;
      this.sprites.push(s);
      this.group.add(s);
    }
  }

  update(dt: number, camX: number, camZ: number, night: number, storm: number): void {
    const tint = new THREE.Color().setHSL(0.6, 0.15, THREE.MathUtils.lerp(0.95, 0.32, night));
    const op = THREE.MathUtils.clamp(0.42 + storm * 0.45, 0, 0.9);
    for (const s of this.sprites) {
      s.position.x += this.wind.x * dt;
      s.position.z += this.wind.y * dt;
      // wrap within the box centred on the player
      if (s.position.x - camX > SPREAD) s.position.x -= SPREAD * 2;
      if (s.position.x - camX < -SPREAD) s.position.x += SPREAD * 2;
      if (s.position.z - camZ > SPREAD) s.position.z -= SPREAD * 2;
      if (s.position.z - camZ < -SPREAD) s.position.z += SPREAD * 2;
      const sm = s.material as THREE.SpriteMaterial;
      sm.color.copy(tint);
      sm.opacity = op;
    }
  }

  dispose(): void {
    this.tex.dispose();
    for (const s of this.sprites) (s.material as THREE.Material).dispose();
  }
}
