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
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e9;
const vec = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every(finite);
const kinds = ["cube", "sphere", "cylinder", "plane"];
export function parseProject(text: string): Project {
  if (text.length > 20_000_000) throw Error("Файл превышает допустимые 20 МБ.");
  let p: unknown;
  try {
    p = JSON.parse(text);
  } catch {
    throw Error("Файл не содержит корректный JSON.");
  }
  if (
    !isRecord(p) ||
    p.schemaVersion !== 1 ||
    typeof p.name !== "string" ||
    p.name.length > 200 ||
    !["m", "cm", "mm"].includes(String(p.units)) ||
    !Array.isArray(p.objects) ||
    p.objects.length > 10000
  )
    throw Error("Неподдерживаемый формат проекта FORMA.");
  const ids = new Set<string>();
  for (const o of p.objects) {
    if (
      !isRecord(o) ||
      typeof o.id !== "string" ||
      !o.id ||
      ids.has(o.id) ||
      typeof o.name !== "string" ||
      o.name.length > 200 ||
      !kinds.includes(String(o.type)) ||
      typeof o.visible !== "boolean" ||
      typeof o.locked !== "boolean" ||
      !(o.parentId === null || typeof o.parentId === "string") ||
      !isRecord(o.transform) ||
      !vec(o.transform.position) ||
      !vec(o.transform.rotation) ||
      !vec(o.transform.scale) ||
      o.transform.scale.some((n) => n <= 0) ||
      !isRecord(o.geometry) ||
      o.geometry.kind !== o.type ||
      !finite(o.geometry.size) ||
      o.geometry.size <= 0 ||
      !isRecord(o.material) ||
      typeof o.material.color !== "string" ||
      !/^#[0-9a-f]{6}$/i.test(o.material.color) ||
      !finite(o.material.roughness) ||
      o.material.roughness < 0 ||
      o.material.roughness > 1 ||
      !finite(o.material.metalness) ||
      o.material.metalness < 0 ||
      o.material.metalness > 1
    )
      throw Error("Некорректный объект или повторяющийся идентификатор.");
    ids.add(o.id);
  }
  for (const o of p.objects) {
    let current = o;
    const chain = new Set<string>();
    while (current.parentId !== null) {
      if (chain.has(current.id)) throw Error("Циклическая структура объектов.");
      chain.add(current.id);
      const parent = p.objects.find((x) => x.id === current.parentId);
      if (!parent) throw Error("Не найден родитель объекта.");
      current = parent;
    }
  }
  const c = p.camera;
  if (
    !isRecord(c) ||
    !vec(c.position) ||
    !vec(c.target) ||
    !["perspective", "orthographic"].includes(String(c.projection)) ||
    !finite(c.zoom) ||
    c.zoom <= 0 ||
    c.position.every((n, i) => n === (c.target as number[])[i])
  )
    throw Error("Некорректные параметры камеры.");
  return clone(p as unknown as Project);
}
export const serializeProject = (p: Project): string => {
  const text = JSON.stringify(p, null, 2);
  parseProject(text);
  return text;
};
