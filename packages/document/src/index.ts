import {
  clone,
  primitiveNames,
  type Primitive,
  type Project,
  type SceneObject,
} from "@forma/shared";
export function emptyProject(name = "Без названия"): Project {
  return {
    schemaVersion: 1,
    name,
    units: "m",
    objects: [],
    camera: {
      position: [9, 7, 10],
      target: [0, 0, 0],
      projection: "perspective",
      zoom: 1,
    },
  };
}
export function createObject(type: Primitive, index = 0): SceneObject {
  return {
    id: crypto.randomUUID(),
    name: `${primitiveNames[type]} ${index + 1}`,
    type,
    geometry: { kind: type, size: 2 },
    transform: {
      position: [0, type === "plane" ? 0 : 1, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
    material: { color: "#a9c6e8", roughness: 0.55, metalness: 0.12 },
    visible: true,
    locked: false,
    parentId: null,
  };
}
export { validateProject } from "./document-validation";
export { MAX_PROJECT_BYTES } from "./validation";
export * from "./v2";
import { validateProject } from "./document-validation";
import { MAX_PROJECT_BYTES } from "./validation";
import type { Document } from "./v2";
export function parseProject(text: string): Document {
  if (new TextEncoder().encode(text).byteLength > MAX_PROJECT_BYTES)
    throw Error("Файл превышает допустимые 20 МБ.");
  let candidate: unknown;
  try {
    candidate = JSON.parse(text);
  } catch {
    throw Error("Файл не содержит корректный JSON.");
  }
  validateProject(candidate);
  return clone(candidate);
}
export function serializeProject(project: Document): string {
  validateProject(project);
  const text = JSON.stringify(project, null, 2);
  if (new TextEncoder().encode(text).byteLength > MAX_PROJECT_BYTES)
    throw Error("Файл превышает допустимые 20 МБ.");
  return text;
}
