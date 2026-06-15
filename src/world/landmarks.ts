import * as THREE from 'three';
import { LANDMARKS, type LandmarkDef } from '../data/landmarks';
import type { RNG } from '../core/rng';
import { Road } from './road';
import { makeBillboardTexture } from './textures';

/**
 * Landmark set-pieces. Original stylized low-poly builders, ONE active at a
 * time, pooled (the active group is reused — geometry rebuilt only on swap).
 * Rises from the fog with a nameplate, sweeps past, recycles. (isLandmarked)
 */

function buildTower(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.7, metalness: 0.3, flatShading: true });
  // four tapering tiers
  const tiers = [[18, 6, 0], [14, 28, 26], [9, 18, 56], [3, 26, 76]];
  for (const [r, h, y] of tiers) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.35, r, h, 4), mat);
    m.position.y = y + h / 2;
    m.rotation.y = Math.PI / 4;
    m.castShadow = true;
    g.add(m);
  }
  const tip = new THREE.Mesh(new THREE.ConeGeometry(1, 14, 4), mat);
  tip.position.y = 102;
  g.add(tip);
  return g;
}

function buildPyramids(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xd8b878, roughness: 1, flatShading: true });
  const sizes = [[34, 46, 0, 0], [24, 34, 50, 18], [16, 22, -38, 30]];
  for (const [r, h, x, z] of sizes) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 4), mat);
    m.position.set(x, h / 2, z);
    m.rotation.y = Math.PI / 4;
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

function buildArch(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xcfc3a8, roughness: 0.9, flatShading: true });
  const leg = new THREE.BoxGeometry(7, 34, 9);
  for (const x of [-16, 16]) {
    const m = new THREE.Mesh(leg, mat); m.position.set(x, 17, 0); m.castShadow = true; g.add(m);
  }
  const top = new THREE.Mesh(new THREE.BoxGeometry(46, 12, 11), mat);
  top.position.y = 40; top.castShadow = true; g.add(top);
  return g;
}

function buildStatue(): THREE.Group {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0x6fae9c, roughness: 0.85, flatShading: true });
  const base = new THREE.Mesh(new THREE.BoxGeometry(20, 22, 20), new THREE.MeshStandardMaterial({ color: 0x8a8170, roughness: 1, flatShading: true }));
  base.position.y = 11; base.castShadow = true; g.add(base);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(5, 7, 30, 8), stone);
  body.position.y = 38; body.castShadow = true; g.add(body);
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(4, 0), stone);
  head.position.y = 56; g.add(head);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 20, 6), stone);
  arm.position.set(5, 56, 0); arm.rotation.z = -0.7; g.add(arm);
  const torch = new THREE.Mesh(new THREE.ConeGeometry(3, 6, 6), new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0xffb347, emissiveIntensity: 0.6, flatShading: true }));
  torch.position.set(12, 66, 0); g.add(torch);
  return g;
}

const BUILDERS: Record<LandmarkDef['build'], () => THREE.Group> = {
  tower: buildTower, pyramids: buildPyramids, arch: buildArch, statue: buildStatue,
};

/** cheap far impostor: a flat dark silhouette card sized to the landmark. */
function buildImpostor(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x2a2f38, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
  const card = new THREE.Mesh(new THREE.PlaneGeometry(70, 90), mat);
  card.position.y = 45;
  g.add(card);
  return g;
}

export class Landmarks {
  group = new THREE.Group();
  private holder = new THREE.Group();
  private impostor = new THREE.Group();
  private board: THREE.Mesh;
  private rng: RNG;
  private road: Road;
  private active: LandmarkDef | null = null;
  private z = 9999;
  private cooldown = 18; // seconds before first
  private detailed = false; // currently showing full model vs impostor
  onReveal?: (name: string, location: string) => void;
  private revealed = false;

  constructor(rng: RNG, road: Road) {
    this.rng = rng;
    this.road = road;
    this.group.add(this.holder);
    this.impostor = buildImpostor();
    this.impostor.visible = false;
    this.group.add(this.impostor);
    // a distant billboard / nameplate panel that pairs with imagery
    this.board = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 12),
      new THREE.MeshBasicMaterial({ map: makeBillboardTexture('LANDMARK'), transparent: true })
    );
    this.board.visible = false;
    this.group.add(this.board);
  }

  private spawn(biomeId: string, totalDist: number): void {
    const options = LANDMARKS.filter((l) => l.biomes.includes(biomeId));
    if (!options.length) return;
    const def = this.rng.pick(options);
    this.active = def;
    this.revealed = false;
    // spawn far as a cheap impostor; the full model is built only on near-swap
    this.clearHolder();
    this.detailed = false;
    this.holder.visible = false;
    this.impostor.visible = true;
    this.z = -380;
    (this.board.material as THREE.MeshBasicMaterial).map = makeBillboardTexture(def.location.toUpperCase());
    (this.board.material as THREE.MeshBasicMaterial).needsUpdate = true;
    void totalDist;
  }

  private clearHolder(): void {
    for (let i = this.holder.children.length - 1; i >= 0; i--) {
      const c = this.holder.children[i] as THREE.Group;
      c.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((mm) => mm.dispose());
      });
      this.holder.remove(c);
    }
  }

  update(dt: number, delta: number, totalDist: number, biomeId: string): void {
    if (!this.active) {
      this.cooldown -= dt;
      if (this.cooldown <= 0) { this.spawn(biomeId, totalDist); this.cooldown = this.rng.range(45, 80); }
      return;
    }
    this.z += delta;
    const cx = this.road.curveX(totalDist + -this.z);
    const off = this.active.side === 0 ? 0 : this.active.side * 90;
    this.holder.position.set(cx + off, 0, this.z - 60);
    this.impostor.position.set(cx + off, 0, this.z - 60);
    this.board.position.set(cx + off, 16, this.z - 20);
    this.board.visible = this.z < -40 && this.z > -260;

    // far-LOD swap: build the full model only when it comes close, drop back to
    // the impostor (and free the model) once it recedes again.
    const NEAR = -230;
    if (!this.detailed && this.z > NEAR) {
      this.detailed = true;
      const model = BUILDERS[this.active.build]();
      this.holder.add(model);
      this.holder.visible = true;
      this.impostor.visible = false;
    } else if (this.detailed && this.z < NEAR - 40) {
      this.detailed = false;
      this.clearHolder();
      this.holder.visible = false;
      this.impostor.visible = true;
    }

    if (!this.revealed && this.z > -200) {
      this.revealed = true;
      this.onReveal?.(this.active.name, this.active.location);
    }
    if (this.z > 120) {
      this.clearHolder();
      this.holder.visible = false;
      this.impostor.visible = false;
      this.board.visible = false;
      this.active = null;
    }
  }

  dispose(): void {
    this.clearHolder();
    this.board.geometry.dispose();
    (this.board.material as THREE.MeshBasicMaterial).map?.dispose();
    (this.board.material as THREE.Material).dispose();
  }
}
