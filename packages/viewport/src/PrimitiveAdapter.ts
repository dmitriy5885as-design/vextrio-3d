import * as THREE from "three";
import type { SceneObject, Vec3 } from "@forma/shared";
export interface GeometryResult {
  geometry: THREE.BufferGeometry;
  entityId: string;
}
export interface GeometryAdapter {
  create(
    description: SceneObject["geometry"],
    entityId: string,
  ): GeometryResult;
  bounds(description: SceneObject["geometry"]): { min: Vec3; max: Vec3 };
  serialize(description: SceneObject["geometry"]): string;
  operation(name: string): never;
}
export class PrimitiveAdapter implements GeometryAdapter {
  create(d: SceneObject["geometry"], entityId: string): GeometryResult {
    let geometry: THREE.BufferGeometry;
    switch (d.kind) {
      case "cube":
        geometry = new THREE.BoxGeometry(d.size, d.size, d.size);
        break;
      case "sphere":
        geometry = new THREE.SphereGeometry(d.size / 2, 40, 24);
        break;
      case "cylinder":
        geometry = new THREE.CylinderGeometry(
          d.size / 2,
          d.size / 2,
          d.size,
          40,
        );
        break;
      case "plane":
        geometry = new THREE.PlaneGeometry(d.size, d.size);
        geometry.rotateX(-Math.PI / 2);
        break;
    }
    return { geometry, entityId };
  }
  bounds(d: SceneObject["geometry"]) {
    const s = d.size / 2;
    return {
      min: [-s, d.kind === "plane" ? 0 : -s, -s] as Vec3,
      max: [s, d.kind === "plane" ? 0 : s, s] as Vec3,
    };
  }
  serialize(d: SceneObject["geometry"]) {
    return JSON.stringify(d);
  }
  operation(name: string): never {
    throw Error(
      `Операция «${name}» пока не поддерживается геометрическим ядром.`,
    );
  }
}
