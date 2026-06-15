import * as THREE from 'three';
import type { RNG } from '../core/rng';
import { Road, LANE_OFFSET } from './road';
import { VEHICLES, type VehicleDef, type VehicleModel } from '../car/vehicles';

/**
 * Light traffic drawn from the SAME vehicle roster as the player, for variety:
 * you pass SUVs, the odd supercar, a slow semi or monster truck. Each spawned
 * car cruises at a speed appropriate to its real top speed (trucks slow, sports
 * cars fast), still soft / non-punishing — brushing one is like any other prop.
 *
 * Pooling: distinct silhouettes can't share one InstancedMesh, so we pre-build a
 * small fixed pool of model clones PER TYPE (low-poly, cheap) and check them out
 * to active cars. Off-pool models are parked far below the world. Capped + scaled
 * via setDensity (so the low tier shows fewer). No per-frame allocation.
 */

interface TCar {
  z: number; // world z (relative, scrolls toward camera)
  lane: number; // 0..2 lane index -> offset
  relSpeed: number; // m/s relative to player
  active: boolean;
  type: number; // index into pool types
  slot: number; // index into that type's clone pool
}

const LANES = [-LANE_OFFSET, 0, LANE_OFFSET];
const MAX = 14;

// per-type colour variety
const PALETTE = [0x2f6fb0, 0xb0432f, 0xe0c24a, 0x3a9a6a, 0xcfd3d8, 0x55585f, 0x8a4fb0, 0xd98a2b];

interface TypePool {
  def: VehicleDef;
  clones: VehicleModel[];
  cruise: number; // baseline m/s for this type (from topSpeed)
  used: boolean[];
}

export class Traffic {
  group = new THREE.Group();
  private cars: TCar[] = [];
  private pools: TypePool[] = [];
  private rng: RNG;
  private road: Road;
  private spawnAccum = 0;
  private density = 1;
  private cap = MAX;

  constructor(rng: RNG, road: Road) {
    this.rng = rng;
    this.road = road;

    // Build a small clone pool per type. Sports cars / common cars get more
    // clones; heavy rigs are rarer so 1 each keeps poly budget tight.
    const clonesByType: Record<string, number> = {
      coupe: 3, suv: 2, supercar: 2, lambo: 1, f1: 1, moto: 2, semi: 1, monster: 1,
    };
    let colorI = 0;
    for (const def of VEHICLES) {
      const n = clonesByType[def.id] ?? 1;
      const clones: VehicleModel[] = [];
      const used: boolean[] = [];
      for (let i = 0; i < n; i++) {
        const m = def.build(PALETTE[colorI++ % PALETTE.length]);
        m.group.position.set(0, -9999, 0);
        m.group.traverse((o) => { (o as THREE.Mesh).castShadow = (o as THREE.Mesh).isMesh; });
        this.group.add(m.group);
        clones.push(m);
        used.push(false);
      }
      // cruise speed in m/s derived from real top speed (a fraction so traffic
      // stays calm); slower vehicles genuinely lag, fast ones overtake.
      const cruise = (def.topSpeed / 3.6) * 0.42;
      this.pools.push({ def, clones, cruise, used });
    }

    for (let i = 0; i < MAX; i++) {
      this.cars.push({ z: 9999, lane: 0, relSpeed: 0, active: false, type: -1, slot: -1 });
    }
  }

  setDensity(d: number): void {
    this.density = d;
    this.cap = Math.max(0, Math.floor(MAX * d));
  }

  /** Pick a random type that has a free clone, weighted toward common cars. */
  private pickType(): number {
    // weighted bag: favour ordinary traffic, sprinkle exotics/rigs
    const weights = [5, 1, 2, 1, 2, 4, 1, 1]; // coupe..monster (matches VEHICLES order)
    let total = 0;
    const avail: number[] = [];
    for (let t = 0; t < this.pools.length; t++) {
      if (this.pools[t].used.some((u) => !u)) { avail.push(t); total += weights[t] ?? 1; }
    }
    if (!avail.length) return -1;
    let r = this.rng.range(0, total);
    for (const t of avail) { r -= weights[t] ?? 1; if (r <= 0) return t; }
    return avail[avail.length - 1];
  }

  private spawn(playerSpeed: number): void {
    let active = 0;
    for (const c of this.cars) if (c.active) active++;
    if (active >= this.cap) return;
    const idx = this.cars.findIndex((c) => !c.active);
    if (idx < 0) return;
    const type = this.pickType();
    if (type < 0) return;
    const pool = this.pools[type];
    const slot = pool.used.findIndex((u) => !u);
    if (slot < 0) return;

    const c = this.cars[idx];
    c.active = true;
    c.type = type;
    c.slot = slot;
    pool.used[slot] = true;
    c.lane = this.rng.int(0, 2);

    // this car's own cruise relative to the player; spawn ahead (we approach,
    // slower) or behind (it overtakes, faster). Derived from its real topSpeed.
    const own = pool.cruise;
    const rel = own - playerSpeed;
    const ahead = rel < 1.5 ? true : this.rng.bool(0.6);
    c.z = ahead ? -200 - this.rng.range(0, 130) : 60 + this.rng.range(0, 40);
    c.relSpeed = THREE.MathUtils.clamp(rel + this.rng.range(-2, 2), -9, 7);
  }

  private park(c: TCar): void {
    const pool = this.pools[c.type];
    if (pool) {
      pool.used[c.slot] = false;
      pool.clones[c.slot].group.position.set(0, -9999, 0);
    }
    c.active = false;
    c.type = -1;
    c.slot = -1;
  }

  update(dt: number, scroll: number, totalDist: number, playerSpeed: number): void {
    if (this.cap > 0) {
      this.spawnAccum += (scroll * 0.12 + dt * 4) * this.density;
      while (this.spawnAccum > 10) { this.spawnAccum -= 10; this.spawn(playerSpeed); }
    }

    for (const c of this.cars) {
      if (!c.active) continue;
      c.z += scroll + c.relSpeed * dt;
      if (c.z > 70 || c.z < -360) { this.park(c); continue; }
      const model = this.pools[c.type].clones[c.slot];
      const cx = this.road.curveX(totalDist + -c.z);
      const heading = this.road.headingAt(totalDist + -c.z);
      model.group.position.set(cx + LANES[c.lane], 0, c.z);
      model.group.rotation.set(0, -heading, 0);
      // spin wheels by this car's ground speed
      const ground = playerSpeed + c.relSpeed;
      for (const w of model.wheels) w.rotation.x += (ground / 0.45) * dt;
    }
  }

  get activeCount(): number { return this.cars.filter((c) => c.active).length; }

  dispose(): void {
    for (const pool of this.pools) {
      for (const m of pool.clones) {
        m.group.traverse((o) => { (o as THREE.Mesh).geometry?.dispose(); });
      }
    }
  }
}
