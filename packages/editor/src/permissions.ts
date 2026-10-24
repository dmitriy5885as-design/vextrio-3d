import type { Project, SceneObject } from "@forma/shared";
export type MutationAction =
  { kind: "edit" } | { kind: "set-lock"; id: string; locked: boolean };
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
export function isObjectLocked(
  project: Project,
  id: string,
  ancestorsOnly = false,
) {
  const object = project.objects.find((o) => o.id === id);
  const target = ancestorsOnly ? object?.parentId : id;
  return target ? lockLookup(project)(target) : false;
}
export function authorizeMutation(
  before: Project,
  after: Project,
  action: MutationAction,
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
