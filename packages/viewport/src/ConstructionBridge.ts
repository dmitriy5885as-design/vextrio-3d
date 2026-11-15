import * as THREE from "three";
import {
  constructionData,
  definitionOccurrences,
  type Document,
} from "@forma/document";
import {
  transformAffine,
  add,
  multiply,
  subtract,
  length,
} from "@forma/geometry";
export class ConstructionBridge {
  readonly root = new THREE.Group();
  private project: Document | null = null;
  update(project: Document) {
    if (project === this.project) return;
    this.project = project;
    this.clear();
    if (project.schemaVersion !== 2) return;
    const guides = Object.values(constructionData(project).guides);
    if (!guides.length) return;
    for (const o of definitionOccurrences(project)) {
      if (!o.visible) continue;
      for (const guide of guides) {
        if (guide.definitionId !== o.definitionId) continue;
        const origin = transformAffine(guide.origin, o.worldTransform);
        if (guide.kind === "point") {
          const geometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(...origin),
          ]);
          const point = new THREE.Points(
            geometry,
            new THREE.PointsMaterial({
              color: 0x4dd5c0,
              size: 7,
              sizeAttenuation: false,
            }),
          );
          point.userData.constructionId = guide.id;
          this.root.add(point);
        } else {
          const vector = subtract(
            transformAffine(
              add(guide.origin, guide.direction!),
              o.worldTransform,
            ),
            origin,
          );
          const direction = multiply(vector, 1000 / length(vector));
          const geometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(...subtract(origin, direction)),
            new THREE.Vector3(...add(origin, direction)),
          ]);
          const line = new THREE.Line(
            geometry,
            new THREE.LineDashedMaterial({
              color: 0x4dd5c0,
              dashSize: 0.15,
              gapSize: 0.1,
            }),
          );
          line.computeLineDistances();
          line.userData.constructionId = guide.id;
          this.root.add(line);
        }
      }
    }
  }
  clear() {
    for (const child of [...this.root.children]) {
      const object = child as THREE.Line;
      object.geometry.dispose();
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      materials.forEach((m) => m.dispose());
      this.root.remove(child);
    }
  }
  dispose() {
    this.clear();
  }
}
