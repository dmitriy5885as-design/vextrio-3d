import { create } from "zustand";
import {
  clone,
  freezeData,
  type Project,
  type Primitive,
  type SceneObject,
  type CameraData,
  type TransformMode,
} from "@forma/shared";
import { createObject, emptyProject, validateProject } from "@forma/document";
import { CommandHistory, SnapshotCommand } from "@forma/commands";
import {
  authorizeMutation,
  editableObjectKeys,
  isObjectLocked,
  type MutationAction,
} from "./permissions";
export { isObjectLocked } from "./permissions";
export type CommandResult =
  { status: "applied" | "noop" } | { status: "rejected"; error: string };
export type ObjectPatch = Partial<
  Pick<
    SceneObject,
    "name" | "transform" | "geometry" | "material" | "visible" | "parentId"
  >
>;
interface EditorState {
  project: Project;
  selected: string | null;
  tool: TransformMode | "select";
  revision: number;
  savedSignature: string;
  grid: boolean;
  snap: boolean;
  theme: "dark" | "light";
  sensitivity: number;
  message: string;
  cameraRequest: { view: string; nonce: number } | null;
  mutate: (label: string, fn: (candidate: Project) => void) => CommandResult;
  add: (type: Primitive) => CommandResult;
  select: (id: string | null) => void;
  patch: (id: string, patch: ObjectPatch) => CommandResult;
  setLocked: (id: string, locked: boolean) => CommandResult;
  remove: () => CommandResult;
  duplicate: () => CommandResult;
  undo: () => CommandResult;
  redo: () => CommandResult;
  canUndo: boolean;
  canRedo: boolean;
  replace: (project: Project) => CommandResult;
  setTool: (tool: EditorState["tool"]) => void;
  setCamera: (camera: CameraData) => CommandResult;
  view: (view: string) => void;
  markSaved: (signature: string) => void;
  notify: (message: string) => void;
}
const history = new CommandHistory();
const initial = freezeData(emptyProject());
export const useEditor = create<EditorState>((set, get) => {
  let transactionInProgress = false;
  const reject = (error: unknown): CommandResult => {
    const message =
      error instanceof Error ? error.message : "Не удалось выполнить действие.";
    set({ message });
    return { status: "rejected", error: message };
  };
  const commit = (
    label: string,
    fn: (candidate: Project) => void,
    action: MutationAction = { kind: "edit" },
  ): CommandResult => {
    if (transactionInProgress)
      return reject(Error("Вложенная команда запрещена."));
    transactionInProgress = true;
    try {
      const before = get().project,
        candidate = clone(before);
      const returned: unknown = fn(candidate);
      if (returned && typeof returned === "object" && "then" in returned) {
        void Promise.resolve(returned).catch(() => {});
        throw Error("Изменение документа должно быть синхронным.");
      }
      validateProject(candidate);
      authorizeMutation(before, candidate, action);
      if (JSON.stringify(before) === JSON.stringify(candidate))
        return { status: "noop" };
      const project = history.run(
        new SnapshotCommand(label, before, candidate),
        before,
      );
      set({
        project: freezeData(project),
        revision: get().revision + 1,
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        message: label,
      });
      return { status: "applied" };
    } catch (error) {
      return reject(error);
    } finally {
      transactionInProgress = false;
    }
  };
  return {
    project: initial,
    selected: null,
    tool: "select",
    revision: 0,
    savedSignature: JSON.stringify(initial),
    grid: true,
    snap: false,
    theme: "dark",
    sensitivity: 1,
    message: "Готово к работе",
    cameraRequest: null,
    canUndo: false,
    canRedo: false,
    mutate: (label, fn) => commit(label, fn),
    add: (type) => {
      try {
        const object = createObject(
          type,
          get().project.objects.filter((o) => o.type === type).length,
        );
        object.transform.position[0] = get().project.objects.length * 0.5;
        const result = commit(`Создан объект: ${object.name}`, (p) =>
          p.objects.push(object),
        );
        if (result.status === "applied")
          set({ selected: object.id, tool: "translate" });
        return result;
      } catch (error) {
        return reject(error);
      }
    },
    select: (selected) => {
      if (!transactionInProgress) set({ selected });
    },
    patch: (id, patch) =>
      commit("Изменение свойств", (p) => {
        if (
          Object.keys(patch).some(
            (key) => !editableObjectKeys.has(key as keyof SceneObject),
          )
        )
          throw Error(
            "Недопустимое свойство. Блокировка меняется отдельным действием.",
          );
        const object = p.objects.find((o) => o.id === id);
        if (!object) throw Error("Объект не найден.");
        Object.assign(object, clone(patch));
      }),
    setLocked: (id, locked) =>
      commit(
        locked ? "Объект заблокирован" : "Объект разблокирован",
        (p) => {
          const object = p.objects.find((o) => o.id === id);
          if (!object) throw Error("Объект не найден.");
          object.locked = locked;
        },
        { kind: "set-lock", id, locked },
      ),
    remove: () => {
      const id = get().selected;
      if (!id) return { status: "noop" };
      const result = commit("Удаление объекта", (p) => {
        p.objects = p.objects.filter((o) => o.id !== id);
        for (const object of p.objects)
          if (object.parentId === id) object.parentId = null;
      });
      if (result.status === "applied") set({ selected: null });
      return result;
    },
    duplicate: () => {
      const before = get().project,
        source = before.objects.find((o) => o.id === get().selected);
      if (!source) return { status: "noop" };
      if (isObjectLocked(before, source.id))
        return reject(Error("Объект или его родитель заблокирован."));
      const copy = clone(source);
      copy.id = crypto.randomUUID();
      copy.name = `${copy.name} — копия`.slice(0, 200);
      copy.transform.position[0] += 2.5;
      const result = commit("Дублирование объекта", (p) =>
        p.objects.push(copy),
      );
      if (result.status === "applied") set({ selected: copy.id });
      return result;
    },
    undo: () => {
      if (transactionInProgress)
        return reject(Error("Вложенная команда запрещена."));
      if (!history.canUndo) return { status: "noop" };
      try {
        const camera = get().project.camera;
        const project = history.undo(get().project, (p) => ({
          ...p,
          camera: clone(camera),
        }));
        set({
          project: freezeData(project),
          selected: project.objects.some((o) => o.id === get().selected)
            ? get().selected
            : null,
          revision: get().revision + 1,
          canUndo: history.canUndo,
          canRedo: history.canRedo,
          message: "Действие отменено",
        });
        return { status: "applied" };
      } catch (error) {
        return reject(error);
      }
    },
    redo: () => {
      if (transactionInProgress)
        return reject(Error("Вложенная команда запрещена."));
      if (!history.canRedo) return { status: "noop" };
      try {
        const camera = get().project.camera;
        const project = history.redo(get().project, (p) => ({
          ...p,
          camera: clone(camera),
        }));
        set({
          project: freezeData(project),
          selected: project.objects.some((o) => o.id === get().selected)
            ? get().selected
            : null,
          revision: get().revision + 1,
          canUndo: history.canUndo,
          canRedo: history.canRedo,
          message: "Действие повторено",
        });
        return { status: "applied" };
      } catch (error) {
        return reject(error);
      }
    },
    replace: (project) => {
      if (transactionInProgress)
        return reject(Error("Вложенная команда запрещена."));
      try {
        validateProject(project);
        const accepted = clone(project),
          signature = JSON.stringify(accepted);
        history.clear();
        set({
          project: freezeData(accepted),
          selected: null,
          canUndo: false,
          canRedo: false,
          savedSignature: signature,
          revision: get().revision + 1,
          message: "Проект открыт",
          cameraRequest: { view: "restore", nonce: Date.now() },
        });
        return { status: "applied" };
      } catch (error) {
        return reject(error);
      }
    },
    setCamera: (camera) => {
      if (transactionInProgress)
        return reject(Error("Вложенная команда запрещена."));
      try {
        const project = { ...get().project, camera: clone(camera) };
        validateProject(project);
        if (JSON.stringify(get().project.camera) === JSON.stringify(camera))
          return { status: "noop" };
        set({ project: freezeData(project) });
        return { status: "applied" };
      } catch (error) {
        return reject(error);
      }
    },
    setTool: (tool) => {
      if (!transactionInProgress) set({ tool });
    },
    view: (view) => {
      if (!transactionInProgress)
        set({ cameraRequest: { view, nonce: Date.now() } });
    },
    markSaved: (signature) => {
      if (transactionInProgress) return;
      try {
        const project: unknown = JSON.parse(signature);
        validateProject(project);
        set({
          savedSignature: JSON.stringify(project),
          message: "Проект записан на диск",
        });
      } catch (error) {
        reject(error);
      }
    },
    notify: (message) => set({ message }),
  };
});
export const isDirty = () =>
  JSON.stringify(useEditor.getState().project) !==
  useEditor.getState().savedSignature;
