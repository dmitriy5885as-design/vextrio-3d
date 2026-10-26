export const APP_VERSION = "0.2.0-alpha.2";
export const APP_RELEASE_LABEL = "0.2 Alpha";
export type Vec3 = [number, number, number];
export type Primitive = "cube" | "sphere" | "cylinder" | "plane";
export type TransformMode = "translate" | "rotate" | "scale";
export interface Transform {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}
export interface SceneObject {
  id: string;
  name: string;
  type: Primitive;
  transform: Transform;
  geometry: { kind: Primitive; size: number };
  material: { color: string; roughness: number; metalness: number };
  visible: boolean;
  locked: boolean;
  parentId: string | null;
}
export interface CameraData {
  position: Vec3;
  target: Vec3;
  projection: "perspective" | "orthographic";
  zoom: number;
}
export interface Project {
  schemaVersion: 1;
  name: string;
  units: "m" | "cm" | "mm";
  objects: SceneObject[];
  camera: CameraData;
}
export const clone = <T>(value: T): T => structuredClone(value);
export function freezeData<T>(value: T): T {
  const queue: unknown[] = [value];
  while (queue.length) {
    const item = queue.pop();
    if (item && typeof item === "object" && !Object.isFrozen(item)) {
      for (const child of Object.values(item)) queue.push(child);
      Object.freeze(item);
    }
  }
  return value;
}
export const primitiveNames: Record<Primitive, string> = {
  cube: "Куб",
  sphere: "Сфера",
  cylinder: "Цилиндр",
  plane: "Плоскость",
};
