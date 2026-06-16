import * as THREE from 'three';

/**
 * World-space tyre skid dabs for the open world (the old SkidMarks scrolled with
 * the rail road; here the car moves through fixed world space instead). Pooled
 * InstancedMesh: drop a dark quad at each rear wheel while sliding, fade by life,
 * recycle. Purely cosmetic drift feedback.
 */
const dummy = new THREE.Object3D();
const MAX = 160;

interface Mark { x: number; z: number; rot: number; life: number; }

export class Skids {
  group = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private marks: Mark[] = [];
  private cursor = 0;

  constructor() {
    const geo = new THREE.PlaneGeometry(0.3, 1.1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x14110f, transparent: true, opacity: 0.5, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < MAX; i++) {
      this.marks.push({ x: 0, z: 0, rot: 0, life: 0 });
      dummy.position.set(0, -9999, 0); dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
    }
    this.group.add(this.mesh);
  }

  emit(x: number, z: number, rot: number): void {
    const m = this.marks[this.cursor];
    this.cursor = (this.cursor + 1) % MAX;
    m.x = x; m.z = z; m.rot = rot; m.life = 1;
  }

  update(dt: number): void {
    let dirty = false;
    for (let i = 0; i < MAX; i++) {
      const m = this.marks[i];
      if (m.life <= 0) continue;
      m.life -= dt * 0.18;
      dirty = true;
      if (m.life <= 0) {
        dummy.position.set(0, -9999, 0); dummy.updateMatrix();
        this.mesh.setMatrixAt(i, dummy.matrix);
        continue;
      }
      dummy.position.set(m.x, 0.02, m.z);
      dummy.rotation.set(0, m.rot, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
