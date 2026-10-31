import { create } from "zustand";
import {
  ToolController,
  isSketchTool,
  type SketchTool,
  type ToolState,
  type SketchReply,
  type ToolName,
} from "@forma/tools";
import { usePushPull } from "./pushpull";
import { useMove } from "./move";
import { useOffset } from "./offset";
import { usePrecision, precisionFrame } from "./precision";
export * from "./precision";
export * from "./volume-preview";
export * from "./pushpull";
export * from "./offset";
export * from "./move";
export { GeometryDocumentCommand } from "./geometry-command";
import {
  clone,
  freezeData,
  type Project as ProjectV1,
  type Primitive,
  type SceneObject,
  type CameraData,
  type Vec3,
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
  definitionOccurrences,
  occurrenceMatrix,
  type Document as Project,
  type EntityRef,
} from "@forma/document";
import {
  GeometrySession,
  createLocalGeometryBackend,
  type GeometryIntent,
  emptyGeometry,
  id,
  transformAffine,
  inverseAffine,
  tessellateFace,
  tessellationArea,
} from "@forma/geometry";
import { GeometryDocumentCommand } from "./geometry-command";
import {
  groupSceneGeometry,
  copyInstance,
  makeUnique,
  removeInstance,
} from "./structure";
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
const geometryCommits = new Set<Promise<unknown>>();
function trackGeometryCommit<T>(
  work: () => Promise<T>,
  preview = false,
): Promise<T> {
  const result = work();
  if (!preview) {
    geometryCommits.add(result);
    void result.then(
      () => geometryCommits.delete(result),
      () => geometryCommits.delete(result),
    );
  }
  return result;
}
// Persistence waits for already confirmed commands, never for mouse previews.
// Push/Pull can schedule its commit in a React effect after the pointer event.
export async function awaitGeometryCommits() {
  for (const store of [usePushPull, useOffset, useMove]) {
    if (!store.getState().committing) continue;
    await new Promise<void>((resolve) => {
      const unsubscribe = store.subscribe((s) => {
        if (!s.committing) {
          unsubscribe();
          resolve();
        }
      });
    });
  }
  while (geometryCommits.size) await Promise.allSettled([...geometryCommits]);
}
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
  groupScene: (kind?: "group" | "component") => CommandResult;
  setFaceColor: (ref: EntityRef, color: string) => CommandResult;
  copyInstance: (nodeId: string) => CommandResult;
  makeUnique: (nodeId: string) => CommandResult;
  removeInstance: (nodeId: string) => CommandResult;
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
  selectEntity: (ref: EntityRef | null, additive?: boolean) => void;
  topologySelections: EntityRef[];
  topologyHover: EntityRef | null;
  setTopologyHover: (ref: EntityRef | null) => void;
  drawSegments: (
    path: string[],
    segments: [Vec3, Vec3][],
    preview?: boolean,
    accept?: () => boolean,
    shared?: boolean,
  ) => Promise<SketchReply>;
  selectOccurrence: (id: string, path: string[]) => void;
  editGeometry: (
    ref: EntityRef,
    intent: GeometryIntent,
    acceptContext?: () => boolean,
  ) => Promise<CommandResult>;
  tool: ToolName;
  revision: number;
  savedSignature: string;
  grid: boolean;
  snap: boolean;
  theme: "dark" | "light";
  sensitivity: number;
  message: string;
  cameraRequest: { view: string; nonce: number; direction?: Vec3 } | null;
  navigateCamera: (direction: Vec3) => void;
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
let publishingSketch = false;
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
  const structure = (
    label: string,
    fn: (p: import("@forma/document").ProjectV2) => void,
  ): CommandResult => {
    if (transactionInProgress)
      return reject(Error("Другая команда выполняется."));
    transactionInProgress = true;
    try {
      const before = get().project;
      if (before.schemaVersion !== 2)
        throw Error("Для групп нужен документ v2.");
      const candidate = clone(before);
      fn(candidate);
      validateProject(candidate);
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
    } catch (e) {
      return reject(e);
    } finally {
      transactionInProgress = false;
    }
  };
  const pendingGeometry = new Set<GeometrySession>();
  const cancelGeometry = () => {
    useMove.getState().cancel();
    useOffset.getState().cancel();
    for (const session of pendingGeometry) session.cancelAll();
    pendingGeometry.clear();
  };
  return {
    project: initial,
    selected: null,
    selectedPath: null,
    topologySelection: null,
    topologySelections: [],
    topologyHover: null,
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
    setFaceColor: (ref, color) => {
      const result = structure("Цвет грани", (p) => {
        validateEntityRef(p, ref);
        if (ref.kind !== "face") throw Error("Выберите грань.");
        if (isGeometryLocked(p, ref)) throw Error("Геометрия заблокирована.");
        if (!/^#[0-9a-f]{6}$/i.test(color)) throw Error("Некорректный цвет.");
        const face = p.geometries[ref.geometryId].faces[ref.entityId];
        for (const side of ["frontMaterialId", "backMaterialId"] as const) {
          const previous = p.materials[face[side]],
            key = id<"material">("material/" + crypto.randomUUID());
          p.materials[key] = { ...clone(previous), id: key, color };
          face[side] = key;
        }
      });
      if (result.status === "applied") get().selectEntity(ref);
      return result;
    },
    groupScene: (kind = "group") => {
      let ref: EntityRef | null = null;
      const result = structure(
        "Создана " + (kind === "group" ? "группа" : "компонент"),
        (p) => {
          ref = groupSceneGeometry(p, kind, get().topologySelection);
        },
      );
      if (result.status === "applied" && ref) get().selectEntity(ref);
      return result;
    },
    removeInstance: (key) =>
      structure("Удалена сборка", (p) => {
        if (isObjectLocked(p, key)) throw Error("Объект заблокирован.");
        removeInstance(p, key);
      }),
    copyInstance: (key) => {
      const selection = get().topologySelection;
      let newKey = "";
      const result = structure("Создан связанный экземпляр", (p) => {
        if (isObjectLocked(p, key)) throw Error("Объект заблокирован.");
        newKey = copyInstance(p, key);
      });
      if (result.status === "applied" && selection)
        get().selectEntity({ ...selection, occurrencePath: [newKey] });
      return result;
    },
    makeUnique: (key) => {
      let did = "";
      const result = structure("Экземпляр стал независимым", (p) => {
        if (isObjectLocked(p, key)) throw Error("Объект заблокирован.");
        did = makeUnique(p, key);
      });
      if (result.status === "applied") {
        const p = get().project;
        if (p.schemaVersion === 2) {
          const gid = p.definitions[did].geometryId;
          if (gid) {
            const g = p.geometries[gid],
              face = Object.keys(g.faces)[0],
              edge = Object.keys(g.edges)[0],
              vertex = Object.keys(g.vertices)[0];
            if (face || edge || vertex)
              get().selectEntity({
                definitionId: did,
                geometryId: gid,
                kind: face ? "face" : edge ? "edge" : "vertex",
                entityId: face ?? edge ?? vertex,
                occurrencePath: [key],
              });
          }
        }
      }
      return result;
    },
    patchNode: (key, patch) => {
      const selected = get().topologySelection;
      const result = commitDocument(
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
      );
      if (result.status === "applied" && selected && patch.visible !== false) {
        const p = get().project;
        if (p.schemaVersion === 2) {
          try {
            validateEntityRef(p, selected);
            get().selectEntity(selected);
          } catch {}
        }
      }
      return result;
    },
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
    setTopologyHover: (ref) => {
      if (ref) {
        try {
          const p = get().project;
          if (p.schemaVersion !== 2) return;
          validateEntityRef(p, ref);
        } catch {
          ref = null;
        }
      }
      if (JSON.stringify(get().topologyHover) !== JSON.stringify(ref))
        set({ topologyHover: ref ? clone(ref) : null });
    },
    drawSegments: (path, segments, preview = false, accept, shared = false) =>
      trackGeometryCommit<SketchReply>(async () => {
        const before = get().project,
          revision = get().revision;
        let session: GeometrySession | undefined;
        try {
          if (transactionInProgress)
            throw Error("Другая команда ещё выполняется.");
          if (accept && !accept()) throw Error("Построение отменено.");
          if (before.schemaVersion !== 2)
            throw Error(
              "Для рисования преобразуйте проект в v2 через меню значка программы.",
            );
          const definitionId = definitionAtPath(before, path),
            occurrences = definitionOccurrences(before);
          const occurrence = occurrences.find(
            (o) => JSON.stringify(o.path) === JSON.stringify(path),
          );
          if (
            !occurrence?.visible ||
            isGeometryLocked(before, { definitionId })
          )
            throw Error("Контекст скрыт или заблокирован.");
          if (
            !preview &&
            !shared &&
            occurrences.filter((o) => o.definitionId === definitionId).length >
              1
          )
            throw Error(
              "Подтвердите изменение всех экземпляров общего компонента.",
            );
          const staged = clone(before),
            seed: ConstructorParameters<typeof GeometryDocumentCommand>[3] = {};
          let gid = staged.definitions[definitionId].geometryId;
          if (!gid) {
            gid = id("geometry/" + crypto.randomUUID());
            seed.geometry = emptyGeometry(gid, id(definitionId));
            staged.geometries[gid] = clone(seed.geometry);
            staged.definitions[definitionId].geometryId = gid;
          }
          if (!Object.keys(staged.materials).length) {
            const materialId = "material/" + crypto.randomUUID();
            seed.material = {
              id: materialId,
              color: "#86b7c6",
              roughness: 0.7,
              metalness: 0,
            };
            staged.materials[materialId] = clone(seed.material);
          }
          const scope = {
              definitionId,
              geometryId: gid,
              occurrencePath: [...path],
            },
            context = geometryContext(staged, gid, true, path),
            matrix = inverseAffine(occurrenceMatrix(staged, path));
          const local = segments.map(
            ([a, b]) =>
              [transformAffine(a, matrix), transformAffine(b, matrix)] as [
                Vec3,
                Vec3,
              ],
          );
          session = new GeometrySession(
            staged.geometries[gid],
            context,
            createLocalGeometryBackend(context),
            id("draw/" + crypto.randomUUID()),
          );
          pendingGeometry.add(session);
          const result = await session.prepare({
            kind: "insert-segments",
            segments: local,
            plane: null,
          });
          if (accept && !accept()) throw Error("Построение отменено.");
          if (get().revision !== revision)
            throw Error("Результат построения устарел.");
          if (result.status === "noop") return { status: "noop" };
          if (result.status !== "preview")
            throw Error(
              result.status === "error"
                ? result.diagnostics[0].message
                : "Построение отменено.",
            );
          const command = new GeometryDocumentCommand(
            segments.length === 4
              ? "Прямоугольник построен"
              : "Линия построена",
            scope,
            result.change,
            seed,
          );
          const candidate = command.execute(get().project);
          validateProject(candidate);
          if (candidate.schemaVersion !== 2) throw Error("Нужен v2.");
          const g = candidate.geometries[gid],
            world = occurrenceMatrix(candidate, path),
            stats = {
              vertices: Object.keys(g.vertices).length,
              edges: Object.keys(g.edges).length,
              faces: Object.keys(g.faces).length,
              areas: Object.values(g.faces).map((f) =>
                tessellationArea(tessellateFace(g, f), world),
              ),
            };
          if (preview) return { status: "preview", stats };
          const project = history.run(command, get().project);
          publishingSketch = true;
          try {
            set({
              project: freezeData(project),
              revision: revision + 1,
              canUndo: history.canUndo,
              canRedo: history.canRedo,
              topologySelection: null,
              topologySelections: [],
              topologyHover: null,
              message: command.label,
            });
          } finally {
            publishingSketch = false;
          }
          return { status: "applied", stats };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Ошибка построения";
          if (!preview) set({ message });
          return { status: "rejected", error: message };
        } finally {
          if (session) pendingGeometry.delete(session);
        }
      }, preview),
    selectEntity: (ref, additive = false) => {
      if (transactionInProgress) return;
      try {
        if (ref) {
          const p = get().project;
          if (p.schemaVersion !== 2) throw Error("Нужен документ v2.");
          validateEntityRef(p, ref);
        }
        const key = (r: EntityRef) =>
          JSON.stringify([r.geometryId, r.kind, r.entityId, r.occurrencePath]);
        const selections = additive
          ? get().topologySelections.filter((r) => !ref || key(r) !== key(ref))
          : [];
        if (
          ref &&
          (!additive ||
            !get().topologySelections.some((r) => key(r) === key(ref)))
        )
          selections.push(clone(ref));
        set({
          topologySelection: selections.at(-1) ?? null,
          topologySelections: selections,
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
          topologySelections: [],
          topologyHover: null,
        });
      } catch (error) {
        reject(error);
      }
    },
    editGeometry: (ref, intent, acceptContext) =>
      trackGeometryCommit<CommandResult>(async () => {
        if (transactionInProgress)
          return reject(Error("Вложенная команда запрещена."));
        const before = get().project,
          revision = get().revision;
        if (before.schemaVersion !== 2)
          return reject(Error("Для топологии нужен документ v2."));
        let session: GeometrySession | undefined;
        try {
          if (acceptContext && !acceptContext())
            throw Error("Контекст редактирования изменился.");
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
          if (acceptContext && !acceptContext())
            throw Error("Контекст редактирования изменился.");
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
      }),
    select: (selected) => {
      if (!transactionInProgress)
        set({
          selected,
          selectedPath: null,
          topologySelection: null,
          topologySelections: [],
          topologyHover: null,
        });
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
      sketchController.cancel();
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
      sketchController.cancel();
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
        usePrecision
          .getState()
          .configure({ enabled: false, path: [], planeOverride: null });
        usePrecision.getState().setAnchor([0, 0, 0]);
        set({
          project: freezeData(accepted),
          tool: "select",
          selected: null,
          topologySelection: null,
          selectedPath: null,
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
      if (
        (isSketchTool(tool) || tool === "offset") &&
        get().project.schemaVersion !== 2
      ) {
        reject(
          Error(
            "Для рисования преобразуйте проект в v2 через меню значка программы.",
          ),
        );
        return;
      }
      if (!transactionInProgress) set({ tool });
    },
    view: (view) => {
      if (!transactionInProgress)
        set({ cameraRequest: { view, nonce: Date.now() } });
    },
    navigateCamera: (direction) => {
      if (
        !transactionInProgress &&
        direction.length === 3 &&
        direction.every(Number.isFinite) &&
        Math.hypot(...direction) > 1e-9
      )
        set({
          cameraRequest: {
            view: "direction",
            direction: clone(direction),
            nonce: Date.now(),
          },
        });
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

const draw =
  (preview: boolean) => (segments: [Vec3, Vec3][], accept: () => boolean) => {
    const precision = usePrecision.getState();
    return useEditor
      .getState()
      .drawSegments(
        [...precision.path],
        segments,
        preview,
        accept,
        precision.sharedEditConfirmed,
      );
  };
export const sketchController = new ToolController({
  preview: draw(true),
  commit: draw(false),
});
export const useSketch = create<ToolState>(() => sketchController.state);
sketchController.subscribe((state) => {
  useSketch.setState(state, true);
  if ((state.phase === "Start" || state.phase === "Continue") && state.start)
    usePrecision.getState().setAnchor(state.start);
  if (state.tool && (state.phase === "Idle" || state.phase === "Finish"))
    usePrecision.getState().clear();
});
usePrecision.subscribe((s, previous) => {
  if (
    s.path !== previous.path ||
    s.system !== previous.system ||
    s.planeName !== previous.planeName ||
    s.planeOverride !== previous.planeOverride ||
    (!s.enabled && previous.enabled)
  ) {
    sketchController.cancel();
    useMove.getState().cancel();
    useOffset.getState().cancel();
  }
});
useEditor.subscribe((s, previous) => {
  const move = useMove.getState().gesture;
  if (
    move &&
    (s.tool !== "translate" ||
      s.revision !== move.revision ||
      JSON.stringify(s.topologySelections) !== JSON.stringify(move.refs))
  )
    useMove.getState().cancel();
  if (previous.tool === "translate" && s.tool !== "translate" && move)
    usePrecision.getState().configure({ enabled: false });
  const offset = useOffset.getState().gesture;
  if (offset && (s.tool !== "offset" || s.revision !== offset.revision))
    useOffset.getState().cancel();
  const gesture = usePushPull.getState().gesture;
  if (gesture && (s.tool !== "extrude" || s.revision !== gesture.revision))
    usePushPull.getState().cancel();
  if (s.revision !== previous.revision) {
    const a = s.project,
      b = previous.project;
    const geometryChanged =
      a.schemaVersion !== 2 ||
      b.schemaVersion !== 2 ||
      JSON.stringify([a.nodes, a.definitions, a.geometries]) !==
        JSON.stringify([b.nodes, b.definitions, b.geometries]);
    if (!publishingSketch && sketchController.state.tool && geometryChanged)
      sketchController.cancel();
    if (geometryChanged && (s.topologySelections.length || s.topologyHover))
      useEditor.setState({
        topologySelection: null,
        topologySelections: [],
        topologyHover: null,
      });
  }
  if (s.tool !== previous.tool) {
    useMove.getState().cancel();
    const draw = isSketchTool(s.tool);
    if (draw) {
      const p = usePrecision.getState();
      const path = p.path;
      usePrecision.getState().configure({
        enabled: true,
        ...(JSON.stringify(path) !== JSON.stringify(p.path) ? { path } : {}),
      });
      useEditor.setState({ snap: true });
    } else if (isSketchTool(previous.tool))
      usePrecision.getState().configure({ enabled: false });
    sketchController.activate(draw ? (s.tool as SketchTool) : null);
  }
});
export function sketchPlane() {
  const p = useEditor.getState().project;
  if (p.schemaVersion !== 2) throw Error("Нужен документ v2.");
  const plane = precisionFrame(p, usePrecision.getState()).plane;
  return sketchController.state.start
    ? { ...plane, origin: sketchController.state.start }
    : plane;
}
