import { create } from "zustand";
import {
  clone,
  type Project,
  type Primitive,
  type SceneObject,
  type CameraData,
  type TransformMode,
} from "@forma/shared";
import { createObject, emptyProject } from "@forma/document";
import { CommandHistory, SnapshotCommand } from "@forma/commands";
const history = new CommandHistory();
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
  mutate: (label: string, fn: (p: Project) => void) => void;
  add: (type: Primitive) => void;
  select: (id: string | null) => void;
  patch: (id: string, patch: Partial<SceneObject>) => void;
  remove: () => void;
  duplicate: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  replace: (project: Project) => void;
  setTool: (tool: EditorState["tool"]) => void;
  setCamera: (camera: CameraData) => void;
  view: (view: string) => void;
  markSaved: (signature: string) => void;
  notify: (message: string) => void;
}
const initial = emptyProject();
export const useEditor = create<EditorState>((set, get) => ({
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
  mutate: (label, fn) => {
    const before = clone(get().project),
      after = clone(before);
    fn(after);
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    set({
      project: history.run(new SnapshotCommand(label, before, after), before),
      revision: get().revision + 1,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      message: label,
    });
  },
  add: (type) => {
    const obj = createObject(
      type,
      get().project.objects.filter((o) => o.type === type).length,
    );
    obj.transform.position[0] = get().project.objects.length * 0.5;
    get().mutate(`Создан объект: ${obj.name}`, (p) => p.objects.push(obj));
    set({ selected: obj.id, tool: "translate" });
  },
  select: (selected) => set({ selected }),
  patch: (id, patch) => {
    const obj = get().project.objects.find((o) => o.id === id);
    if (!obj || (obj.locked && !("locked" in patch))) return;
    get().mutate("Изменение свойств", (p) => {
      const o = p.objects.find((o) => o.id === id);
      if (o) Object.assign(o, clone(patch));
    });
  },
  remove: () => {
    const id = get().selected;
    if (!id || get().project.objects.find((o) => o.id === id)?.locked) return;
    get().mutate("Удаление объекта", (p) => {
      p.objects = p.objects.filter((o) => o.id !== id);
      for (const o of p.objects) if (o.parentId === id) o.parentId = null;
    });
    set({ selected: null });
  },
  duplicate: () => {
    const source = get().project.objects.find((o) => o.id === get().selected);
    if (!source || source.locked) return;
    const copy = clone(source);
    copy.id = crypto.randomUUID();
    copy.name += " — копия";
    copy.transform.position[0] += 2.5;
    get().mutate("Дублирование объекта", (p) => p.objects.push(copy));
    set({ selected: copy.id });
  },
  undo: () => {
    set({
      project: { ...history.undo(get().project), camera: get().project.camera },
      revision: get().revision + 1,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      message: "Действие отменено",
    });
    if (!get().project.objects.some((o) => o.id === get().selected))
      set({ selected: null });
  },
  redo: () => {
    set({
      project: { ...history.redo(get().project), camera: get().project.camera },
      revision: get().revision + 1,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      message: "Действие повторено",
    });
  },
  replace: (project) => {
    history.clear();
    set({
      project: clone(project),
      selected: null,
      canUndo: false,
      canRedo: false,
      savedSignature: JSON.stringify(project),
      revision: get().revision + 1,
      message: "Проект открыт",
      cameraRequest: { view: "restore", nonce: Date.now() },
    });
  },
  setTool: (tool) => set({ tool }),
  setCamera: (camera) => set((s) => ({ project: { ...s.project, camera } })),
  view: (view) => set({ cameraRequest: { view, nonce: Date.now() } }),
  markSaved: (savedSignature) =>
    set({ savedSignature, message: "Проект сохранён" }),
  notify: (message) => set({ message }),
}));
export const isDirty = () =>
  JSON.stringify(useEditor.getState().project) !==
  useEditor.getState().savedSignature;
