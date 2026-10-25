import { create } from "zustand";
import {
  clone,
  freezeData,
  type Project as ProjectV1,
  type Primitive,
  type SceneObject,
  type CameraData,
  type TransformMode,
} from "@forma/shared";
import {
  createObject,
  emptyProject,
  validateProject,
  getLegacyObjects,
  mutateLegacy,
  migrateProject,
  definitionAtPath,
  validateEntityRef,
  geometryContext,
  type Document as Project,
  type EntityRef,
} from "@forma/document";
import {
  GeometrySession,
  createLocalGeometryBackend,
  type GeometryIntent,
} from "@forma/geometry";
import { GeometryDocumentCommand } from "./geometry-command";
import { isGeometryLocked } from "./permissions";
import { CommandHistory, SnapshotCommand } from "@forma/commands";
import {
  authorizeMutation,
  editableObjectKeys,
  isObjectLocked,
  type MutationAction,
} from "./permissions";
export { isObjectLocked, isGeometryLocked } from "./permissions";
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
  upgradeProject: () => CommandResult;
  patchNode: (
    key: string,
    patch: Partial<
      Pick<
        import("@forma/geometry").InstanceNode,
        "name" | "visible" | "transform"
      >
    >,
  ) => CommandResult;
  setNodeLocked: (key: string, locked: boolean) => CommandResult;
  selectedPath: string[] | null;
  topologySelection: EntityRef | null;
  selectEntity: (ref: EntityRef | null) => void;
  selectOccurrence: (id: string, path: string[]) => void;
  editGeometry: (
    ref: EntityRef,
    intent: GeometryIntent,
  ) => Promise<CommandResult>;
  tool: TransformMode | "select";
  revision: number;
  savedSignature: string;
  grid: boolean;
  snap: boolean;
  theme: "dark" | "light";
  sensitivity: number;
  message: string;
  cameraRequest: { view: string; nonce: number } | null;
  mutate: (label: string, fn: (candidate: ProjectV1) => void) => CommandResult;
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
  const commitDocument = (
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
  const commit = (
    label: string,
    fn: (candidate: ProjectV1) => void,
    action: MutationAction = { kind: "edit" },
  ) => commitDocument(label, (p) => mutateLegacy(p, fn), action);
  const pendingGeometry = new Set<GeometrySession>();
  const cancelGeometry = () => {
    for (const session of pendingGeometry) session.cancelAll();
    pendingGeometry.clear();
  };
  return {
    project: initial,
    selected: null,
    selectedPath: null,
    topologySelection: null,
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
    patchNode: (key, patch) =>
      commitDocument(
        "Изменение узла",
        (p) => {
          if (
            p.schemaVersion !== 2 ||
            !p.nodes[key] ||
            p.nodes[key].kind === "legacy-primitive"
          )
            throw Error("Узел не найден.");
          if (
            Object.keys(patch).some(
              (k) => !["name", "visible", "transform"].includes(k),
            )
          )
            throw Error("Недопустимое свойство узла.");
          Object.assign(p.nodes[key], clone(patch));
        },
        { kind: "native-node", id: key },
      ),
    setNodeLocked: (key, locked) =>
      commitDocument(
        locked ? "Узел заблокирован" : "Узел разблокирован",
        (p) => {
          if (
            p.schemaVersion !== 2 ||
            !p.nodes[key] ||
            p.nodes[key].kind === "legacy-primitive"
          )
            throw Error("Узел не найден.");
          p.nodes[key].locked = locked;
        },
        { kind: "native-node", id: key, setLock: locked },
      ),
    upgradeProject: () => {
      if (transactionInProgress)
        return reject(Error("Вложенная команда запрещена."));
      const before = get().project;
      if (before.schemaVersion === 2) return { status: "noop" };
      try {
        const next = migrateProject(before),
          project = history.run(
            new SnapshotCommand("Миграция в v2", before, next),
            before,
          );
        cancelGeometry();
        set({
          project: freezeData(project),
          revision: get().revision + 1,
          canUndo: history.canUndo,
          canRedo: history.canRedo,
          topologySelection: null,
          message: "Проект преобразован в v2",
        });
        return { status: "applied" };
      } catch (error) {
        return reject(error);
      }
    },
    add: (type) => {
      try {
        const object = createObject(
          type,
          getLegacyObjects(get().project).filter((o) => o.type === type).length,
        );
        object.transform.position[0] =
          getLegacyObjects(get().project).length * 0.5;
        const result = commit(`Создан объект: ${object.name}`, (p) =>
          p.objects.push(object),
        );
        if (result.status === "applied")
          set({
            selected: object.id,
            selectedPath: null,
            topologySelection: null,
            tool: "translate",
          });
        return result;
      } catch (error) {
        return reject(error);
      }
    },
    selectEntity: (ref) => {
      if (transactionInProgress) return;
      try {
        if (ref) {
          const p = get().project;
          if (p.schemaVersion !== 2) throw Error("Нужен документ v2.");
          validateEntityRef(p, ref);
        }
        set({
          topologySelection: ref ? clone(ref) : null,
          selected: null,
          selectedPath: null,
        });
      } catch (error) {
        reject(error);
      }
    },
    selectOccurrence: (key, path) => {
      if (transactionInProgress) return;
      try {
        const p = get().project;
        if (
          p.schemaVersion !== 2 ||
          !p.nodes[key] ||
          p.nodes[key].kind !== "legacy-primitive" ||
          path.length > 128 ||
          definitionAtPath(p, path) !== p.nodes[key].parentDefinitionId
        )
          throw Error("Неверный путь примитива.");
        set({
          selected: key,
          selectedPath: clone(path),
          topologySelection: null,
        });
      } catch (error) {
        reject(error);
      }
    },
    editGeometry: async (ref, intent) => {
      if (transactionInProgress)
        return reject(Error("Вложенная команда запрещена."));
      const before = get().project,
        revision = get().revision;
      if (before.schemaVersion !== 2)
        return reject(Error("Для топологии нужен документ v2."));
      let session: GeometrySession | undefined;
      try {
        validateEntityRef(before, ref);
        if (isGeometryLocked(before, ref))
          throw Error("Геометрический контекст заблокирован.");
        const context = geometryContext(
          before,
          ref.geometryId,
          true,
          ref.occurrencePath,
        );
        session = new GeometrySession(
          before.geometries[ref.geometryId],
          context,
          createLocalGeometryBackend(context),
          ("edit/" +
            crypto.randomUUID()) as import("@forma/geometry").Id<"session">,
        );
        pendingGeometry.add(session);
        const result = await session.prepare(intent);
        if (get().revision !== revision || get().project.schemaVersion !== 2)
          throw Error("Результат геометрии устарел.");
        if (result.status === "noop") return { status: "noop" };
        if (result.status !== "preview")
          throw Error(
            result.status === "error"
              ? result.diagnostics[0].message
              : "Операция отменена.",
          );
        const project = history.run(
          new GeometryDocumentCommand(
            "Изменение геометрии",
            ref,
            result.change,
          ),
          get().project,
        );
        set({
          project: freezeData(project),
          revision: revision + 1,
          canUndo: history.canUndo,
          canRedo: history.canRedo,
          topologySelection: null,
          message: "Геометрия изменена",
        });
        return { status: "applied" };
      } catch (error) {
        return reject(error);
      } finally {
        if (session) pendingGeometry.delete(session);
      }
    },
    select: (selected) => {
      if (!transactionInProgress)
        set({ selected, selectedPath: null, topologySelection: null });
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
        source = getLegacyObjects(before).find((o) => o.id === get().selected);
      if (!source) return { status: "noop" };
      if (isObjectLocked(before, source.id))
        return reject(Error("Объект или его родитель заблокирован."));
      const copy = clone(source);
      copy.id = crypto.randomUUID();
      copy.name = `${copy.name} — копия`.slice(0, 200);
      copy.transform.position[0] += 2.5;
      const result = commitDocument("Дублирование объекта", (p) => {
        mutateLegacy(p, (view) => view.objects.push(copy));
        if (p.schemaVersion === 2 && before.schemaVersion === 2) {
          const parent = before.nodes[source.id].parentDefinitionId,
            node = p.nodes[copy.id];
          p.definitions[p.rootDefinitionId].childNodeIds = p.definitions[
            p.rootDefinitionId
          ].childNodeIds.filter((key) => key !== copy.id);
          node.parentDefinitionId = parent;
          p.definitions[parent].childNodeIds.push(copy.id as never);
        }
      });
      if (result.status === "applied") set({ selected: copy.id });
      return result;
    },
    undo: () => {
      cancelGeometry();
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
          topologySelection: null,
          selected: getLegacyObjects(project).some(
            (o) => o.id === get().selected,
          )
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
      cancelGeometry();
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
          selected: getLegacyObjects(project).some(
            (o) => o.id === get().selected,
          )
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
        cancelGeometry();
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
