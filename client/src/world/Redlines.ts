import { PLATFORM, REDLINE_RADIUS, REDLINES } from '@obby/shared';
import {
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  SphereGeometry,
} from 'three';
import { WORLD_COLORS } from '../config/worldVisuals.js';

/**
 * Red hazard lines strung bank to bank across the gorge.
 *
 * Each line's span comes from the shared config, which derives it from the
 * line's HEIGHT - the canyon widens as it rises, so a high line is a long one.
 * That is what keeps both ends buried in terrain instead of stopping in mid
 * air.
 *
 * One InstancedMesh for every line plus one for the anchor caps: two draw
 * calls for the whole hazard set, however many lines the config defines.
 */
export class Redlines {
  readonly root = new Group();

  private readonly lineGeometry: CylinderGeometry;
  private readonly capGeometry: SphereGeometry;
  private readonly material: MeshBasicMaterial;

  constructor() {
    // A unit-length cylinder laid along X, scaled per line to span the gorge.
    this.lineGeometry = new CylinderGeometry(REDLINE_RADIUS, REDLINE_RADIUS, 1, 6);
    this.lineGeometry.rotateZ(Math.PI / 2);

    this.capGeometry = new SphereGeometry(REDLINE_RADIUS * 2.2, 8, 6);

    // Unlit, so the lines stay a flat vivid red and read clearly in midair
    // against both the bright banks and the dark pit.
    this.material = new MeshBasicMaterial({ color: WORLD_COLORS.redline });

    this.buildLines();
    this.buildCaps();
  }

  dispose(): void {
    this.lineGeometry.dispose();
    this.capGeometry.dispose();
    this.material.dispose();
  }

  private buildLines(): void {
    const mesh = new InstancedMesh(this.lineGeometry, this.material, REDLINES.length);
    const dummy = new Object3D();

    REDLINES.forEach((line, i) => {
      dummy.position.set(0, PLATFORM.topY + line.y, line.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(line.halfSpan * 2, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    this.root.add(mesh);
  }

  /** Small spheres where each line meets the banks, so anchors read clearly. */
  private buildCaps(): void {
    const mesh = new InstancedMesh(this.capGeometry, this.material, REDLINES.length * 2);
    const dummy = new Object3D();
    const matrix = new Matrix4();
    let i = 0;

    for (const line of REDLINES) {
      for (const side of [-1, 1] as const) {
        const x = side * line.halfSpan;
        dummy.position.set(x, PLATFORM.topY + line.y, line.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        matrix.copy(dummy.matrix);
        mesh.setMatrixAt(i, matrix);
        i += 1;
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    this.root.add(mesh);
  }
}
