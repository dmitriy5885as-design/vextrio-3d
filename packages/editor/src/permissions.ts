import type { Project, SceneObject } from "@forma/shared";
import {
  legacyView,
  getLegacyObjects,
  definitionOccurrences,
  type Document,
  type EntityRef,
  type ProjectV2,
} from "@forma/document";
export type MutationAction =
  | { kind: "edit" }
  | { kind: "set-lock"; id: string; locked: boolean }
  | { kind: "native-node"; id: string; setLock?: boolean };
function lockLookup(project: Project) {
  const objects = new Map(project.objects.map((o) => [o.id, o])),
    memo = new Map<string, boolean>();
  return (id: string): boolean => {
    if (memo.has(id)) return memo.get(id)!;
    const path: SceneObject[] = [];
    const visiting = new Set<string>();
    let current = objects.get(id),
      blocked = false;
    while (current) {
      if (memo.has(current.id)) {
        blocked = memo.get(current.id)!;
        break;
      }
      if (visiting.has(current.id)) return true;
      visiting.add(current.id);
      path.push(current);
      current = current.parentId ? objects.get(current.parentId) : undefined;
    }
    for (let i = path.length - 1; i >= 0; i--) {
      blocked = blocked || path[i].locked;
      memo.set(path[i].id, blocked);
    }
    return memo.get(id) ?? false;
  };
}
function isObjectLockedV1(project: Project, id: string, ancestorsOnly = false) {
  const object = project.objects.find((o) => o.id === id);
  const target = ancestorsOnly ? object?.parentId : id;
  return target ? lockLookup(project)(target) : false;
}
function authorizeMutationV1(
  before: Project,
  after: Project,
  action: Exclude<MutationAction, { kind: "native-node" }>,
) {
  const old = new Map(before.objects.map((o) => [o.id, o])),
    next = new Map(after.objects.map((o) => [o.id, o]));
  const lockedBefore = lockLookup(before),
    lockedAfter = lockLookup(after);
  if (action.kind === "set-lock") {
    const original = old.get(action.id);
    if (!original) throw Error("Объект не найден.");
    if (original.parentId && lockedBefore(original.parentId))
      throw Error("Родительский объект заблокирован.");
    const expected = structuredClone(before);
    expected.objects.find((o) => o.id === action.id)!.locked = action.locked;
    if (JSON.stringify(expected) !== JSON.stringify(after))
      throw Error("Действие блокировки не может менять другие свойства.");
    return;
  }
  if (JSON.stringify(before.camera) !== JSON.stringify(after.camera))
    throw Error("Для навигации используйте действие камеры.");
  for (const original of before.objects) {
    const changed = next.get(original.id);
    if (changed && changed.locked !== original.locked)
      throw Error("Используйте отдельное действие блокировки.");
    if (
      lockedBefore(original.id) &&
      JSON.stringify(original) !== JSON.stringify(changed)
    )
      throw Error("Объект или его родитель заблокирован.");
  }
  for (const object of after.objects) {
    if (
      object.parentId &&
      lockedAfter(object.parentId) &&
      JSON.stringify(old.get(object.id)) !== JSON.stringify(object)
    )
      throw Error("Нельзя изменять содержимое заблокированного объекта.");
  }
}
export const editableObjectKeys = new Set<keyof SceneObject>([
  "name",
  "transform",
  "geometry",
  "material",
  "visible",
  "parentId",
]);

export function isObjectLocked(
  p: Document,
  key: string,
  ancestorsOnly = false,
) {
  if (p.schemaVersion === 1) return isObjectLockedV1(p, key, ancestorsOnly);
  const n = p.nodes[key];
  if (!n) return false;
  return (
    (!ancestorsOnly && n.locked) ||
    definitionOccurrences(p).some(
      (o) => o.definitionId === n.parentDefinitionId && o.locked,
    ) ||
    (n.kind === "legacy-primitive" &&
      isObjectLockedV1(legacyView(p), key, ancestorsOnly))
  );
}
export function isGeometryLocked(
  p: ProjectV2,
  ref: Pick<EntityRef, "definitionId">,
) {
  return definitionOccurrences(p).some(
    (o) => o.definitionId === ref.definitionId && o.locked,
  );
}
export function authorizeMutation(
  before: Document,
  after: Document,
  action: MutationAction,
) {
  if (action.kind === "native-node") {
    if (before.schemaVersion !== 2 || after.schemaVersion !== 2)
      throw Error("Нужен документ v2.");
    const old = before.nodes[action.id],
      next = after.nodes[action.id];
    if (
      !old ||
      !next ||
      old.kind === "legacy-primitive" ||
      next.kind !== old.kind
    )
      throw Error("Узел не найден.");
    if (
      isObjectLocked(before, old.id, true) ||
      (action.setLock === undefined && old.locked)
    )
      throw Error("Узел или его родитель заблокирован.");
    const allowed =
      action.setLock === undefined
        ? new Set(["name", "visible", "transform"])
        : new Set(["locked"]);
    for (const key of new Set([...Object.keys(old), ...Object.keys(next)]))
      if (
        !allowed.has(key) &&
        JSON.stringify((old as unknown as Record<string, unknown>)[key]) !==
          JSON.stringify((next as unknown as Record<string, unknown>)[key])
      )
        throw Error("Недопустимое изменение узла.");
    if (action.setLock !== undefined && next.locked !== action.setLock)
      throw Error("Неверное действие блокировки.");
    const expected = structuredClone(before);
    expected.nodes[action.id] = structuredClone(next);
    if (JSON.stringify(expected) !== JSON.stringify(after))
      throw Error("Действие узла изменило другие данные.");
    return;
  }
  if (before.schemaVersion === 1 && after.schemaVersion === 1)
    return authorizeMutationV1(before, after, action);
  if (before.schemaVersion !== 2 || after.schemaVersion !== 2)
    throw Error("Изменение схемы требует явной миграции.");
  authorizeMutationV1(legacyView(before), legacyView(after), action);
  for (const key of [
    "geometries",
    "references",
    "provenance",
    "geometryPolicy",
  ] as const)
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key]))
      throw Error("Legacy-команда не может менять топологию.");
  const natives = (p: ProjectV2) =>
    Object.fromEntries(
      Object.entries(p.nodes).filter(([, n]) => n.kind !== "legacy-primitive"),
    );
  if (JSON.stringify(natives(before)) !== JSON.stringify(natives(after)))
    throw Error("Legacy-команда не может менять группы или компоненты.");
  const defs = (p: ProjectV2) =>
    Object.fromEntries(
      Object.entries(p.definitions).map(([k, d]) => [
        k,
        {
          ...d,
          childNodeIds: d.childNodeIds.filter(
            (n) => p.nodes[n].kind !== "legacy-primitive",
          ),
        },
      ]),
    );
  if (JSON.stringify(defs(before)) !== JSON.stringify(defs(after)))
    throw Error("Изменение определений запрещено.");
  const next = new Map(getLegacyObjects(after).map((o) => [o.id, o]));
  for (const old of getLegacyObjects(before))
    if (
      isObjectLocked(before, old.id) &&
      JSON.stringify(old) !== JSON.stringify(next.get(old.id)) &&
      !(
        action.kind === "set-lock" &&
        action.id === old.id &&
        !isObjectLocked(before, old.id, true)
      )
    )
      throw Error("Объект или его контекст заблокирован.");
  for (const n of Object.values(after.nodes))
    if (
      n.kind === "legacy-primitive" &&
      definitionOccurrences(after).some(
        (o) => o.definitionId === n.parentDefinitionId && o.locked,
      ) &&
      JSON.stringify(before.nodes[n.id]) !== JSON.stringify(n)
    )
      throw Error("Контекст заблокирован.");
}
