import * as THREE from 'three';

/**
 * Pooled tyre skid-mark dabs. When the car slips laterally we drop a small dark
 * quad at each rear wheel; they scroll with the world (toward the camera) and
 * fade out, then recycle. One InstancedMesh, capped, no per-frame allocation.
 * Part of the drift feature. (isChill — purely cosmetic feedback)
 */

const dummy = new THREE.Object3D();
const MAX = 120;

interface Mark { x: number; y: number; z: number; rot: number; life: number; active: boolean; }

export class SkidMarks {
  group = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private marks: Mark[] = [];
  private cursor = 0;

  constructor() {
    const geo = new THREE.PlaneGeometry(0.28, 0.9);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x14110f, transparent: true, opacity: 0.5, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = MAX;
    this.mesh.frustumCulled = false;
    for (let i = 0; i < MAX; i++) {
      this.marks.push({ x: 0, y: 0, z: 0, rot: 0, life: 0, active: false });
      dummy.position.set(0, -9999, 0); dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
    }
    this.group.add(this.mesh);
  }

  /** drop a mark at world (x,z) on surface height y with heading rot */
  emit(x: number, z: number, rot: number, y = 0): void {
    const m = this.marks[this.cursor];
    this.cursor = (this.cursor + 1) % MAX;
    m.x = x; m.y = y; m.z = z; m.rot = rot; m.life = 1; m.active = true;
  }

  update(dt: number, scroll: number): void {
    let dirty = false;
    for (let i = 0; i < MAX; i++) {
      const m = this.marks[i];
      if (!m.active) continue;
      m.z += scroll;
      m.life -= dt * 0.25;
      if (m.life <= 0 || m.z > 40) {
        m.active = false;
        dummy.position.set(0, -9999, 0); dummy.updateMatrix();
        this.mesh.setMatrixAt(i, dummy.matrix);
        dirty = true;
        continue;
      }
      dummy.position.set(m.x, m.y + 0.02, m.z);
      dummy.rotation.set(0, m.rot, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
      dirty = true;
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
