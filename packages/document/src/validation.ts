import type { Project, SceneObject } from "@forma/shared";

export const MAX_PROJECT_BYTES = 20_000_000;
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e9;
const vector = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every(finite);
const kinds = ["cube", "sphere", "cylinder", "plane"];

// Check runtime candidates before JSON.stringify can hide undefined/NaN or run accessors.
export function assertJsonData(value: unknown) {
  const active = new Set<object>();
  const stack: { value: unknown; leave?: boolean }[] = [{ value }];
  while (stack.length) {
    const item = stack.pop()!;
    const v = item.value;
    if (v === null || typeof v === "string" || typeof v === "boolean") continue;
    if (typeof v === "number") {
      if (!Number.isFinite(v))
        throw Error("Документ содержит нечисловое или бесконечное значение.");
      continue;
    }
    if (typeof v !== "object")
      throw Error("Документ содержит несериализуемые данные.");
    if (item.leave) {
      active.delete(v);
      continue;
    }
    if (active.has(v)) throw Error("Циклические данные документа.");
    if (Array.isArray(v) && Object.getPrototypeOf(v) !== Array.prototype)
      throw Error("Недопустимый тип массива документа.");
    if (
      !Array.isArray(v) &&
      ![Object.prototype, null].includes(Object.getPrototypeOf(v))
    )
      throw Error("Недопустимый тип данных документа.");
    active.add(v);
    stack.push({ value: v, leave: true });
    if (Array.isArray(v)) {
      if (
        Reflect.ownKeys(v).some(
          (key) =>
            key !== "length" &&
            (typeof key !== "string" ||
              !/^(0|[1-9]\d*)$/.test(key) ||
              Number(key) >= v.length),
        )
      )
        throw Error("Недопустимое свойство массива документа.");
      for (let i = 0; i < v.length; i++) {
        const d = Object.getOwnPropertyDescriptor(v, String(i));
        if (!d || !("value" in d))
          throw Error("Недопустимый массив документа.");
        stack.push({ value: d.value });
      }
    } else {
      for (const key of Reflect.ownKeys(v)) {
        const d = Object.getOwnPropertyDescriptor(v, key)!;
        if (typeof key !== "string" || !("value" in d) || !d.enumerable)
          throw Error("Недопустимое свойство документа.");
        stack.push({ value: d.value });
      }
    }
  }
}

export function validateProjectV1(value: unknown): asserts value is Project {
  assertJsonData(value);
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    typeof value.name !== "string" ||
    value.name.length > 200 ||
    typeof value.units !== "string" ||
    !["m", "cm", "mm"].includes(value.units) ||
    !Array.isArray(value.objects) ||
    value.objects.length > 10000
  )
    throw Error("Неподдерживаемый формат проекта VEXTRIO 3D.");
  const objects = new Map<string, SceneObject>();
  for (const o of value.objects) {
    if (
      !record(o) ||
      typeof o.id !== "string" ||
      !o.id ||
      objects.has(o.id) ||
      typeof o.name !== "string" ||
      o.name.length > 200 ||
      typeof o.type !== "string" ||
      !kinds.includes(o.type) ||
      typeof o.visible !== "boolean" ||
      typeof o.locked !== "boolean" ||
      !(o.parentId === null || typeof o.parentId === "string") ||
      !record(o.transform) ||
      !vector(o.transform.position) ||
      !vector(o.transform.rotation) ||
      !vector(o.transform.scale) ||
      o.transform.scale.some((n) => n <= 0) ||
      !record(o.geometry) ||
      o.geometry.kind !== o.type ||
      !finite(o.geometry.size) ||
      o.geometry.size <= 0 ||
      !record(o.material) ||
      typeof o.material.color !== "string" ||
      !/^#[0-9a-f]{6}$/i.test(o.material.color) ||
      !finite(o.material.roughness) ||
      o.material.roughness < 0 ||
      o.material.roughness > 1 ||
      !finite(o.material.metalness) ||
      o.material.metalness < 0 ||
      o.material.metalness > 1
    )
      throw Error(
        "Некорректный объект: проверьте ID, размеры, масштаб и материал.",
      );
    objects.set(o.id, o as unknown as SceneObject);
  }
  // Iterative three-colour traversal: O(objects + parent links), including deep chains.
  const colors = new Map<string, 1 | 2>();
  for (const object of objects.values()) {
    if (colors.get(object.id) === 2) continue;
    const chain: string[] = [];
    let current: SceneObject | undefined = object;
    while (current) {
      const color = colors.get(current.id);
      if (color === 2) break;
      if (color === 1) throw Error("Циклическая структура объектов.");
      colors.set(current.id, 1);
      chain.push(current.id);
      if (current.parentId === null) break;
      const parent = objects.get(current.parentId);
      if (!parent) throw Error("Не найден родитель объекта.");
      current = parent;
    }
    for (const id of chain) colors.set(id, 2);
  }
  const c = value.camera;
  if (
    !record(c) ||
    !vector(c.position) ||
    !vector(c.target) ||
    typeof c.projection !== "string" ||
    !["perspective", "orthographic"].includes(c.projection) ||
    !finite(c.zoom) ||
    c.zoom <= 0 ||
    c.position.every((n, i) => n === (c.target as number[])[i])
  )
    throw Error("Некорректные параметры камеры.");
  if (
    new TextEncoder().encode(JSON.stringify(value, null, 2)).byteLength >
    MAX_PROJECT_BYTES
  )
    throw Error("Файл превышает допустимые 20 МБ.");
}
