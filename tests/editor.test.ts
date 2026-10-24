import { beforeEach, describe, expect, it } from "vitest";
import {
  emptyProject,
  createObject,
  parseProject,
  serializeProject,
} from "@forma/document";
import { useEditor } from "@forma/editor";
import { snapPosition } from "@forma/snapping";
beforeEach(() => useEditor.getState().replace(emptyProject()));
describe("Document", () => {
  it("roundtrips objects, materials, camera and units", () => {
    const p = emptyProject("Дом");
    p.objects.push(createObject("cube"));
    p.units = "mm";
    p.camera.projection = "orthographic";
    expect(parseProject(serializeProject(p))).toEqual(p);
  });
  it("creates unique ids", () => {
    expect(
      new Set(Array.from({ length: 500 }, () => createObject("sphere").id))
        .size,
    ).toBe(500);
  });
  it.each(["{", "{}", "null", '{"schemaVersion":2}', "[]"])(
    "rejects invalid file %s",
    (text) => expect(() => parseProject(text)).toThrow(),
  );
  it("rejects duplicate ids and nonfinite values", () => {
    const p = emptyProject();
    const o = createObject("cube");
    p.objects = [o, o];
    expect(() => serializeProject(p)).toThrow();
    p.objects = [o];
    o.transform.position[0] = NaN;
    expect(() => serializeProject(p)).toThrow();
  });
  it("rejects cyclic parents and unknown parent", () => {
    const p = emptyProject();
    const a = createObject("cube"),
      b = createObject("sphere");
    a.parentId = b.id;
    b.parentId = a.id;
    p.objects = [a, b];
    expect(() => serializeProject(p)).toThrow();
    b.parentId = "missing";
    expect(() => serializeProject(p)).toThrow();
  });
  it("rejects invalid camera and negative scale", () => {
    const p = emptyProject();
    p.camera.zoom = 0;
    expect(() => serializeProject(p)).toThrow();
    p.camera.zoom = 1;
    p.objects = [createObject("plane")];
    p.objects[0].transform.scale[0] = -1;
    expect(() => serializeProject(p)).toThrow();
  });
});
describe("Commands", () => {
  it("preserves navigation camera when undoing document edits", () => {
    const s = useEditor.getState();
    s.add("cube");
    const camera = {
      ...useEditor.getState().project.camera,
      position: [12, 8, 3] as [number, number, number],
    };
    s.setCamera(camera);
    s.undo();
    expect(useEditor.getState().project.camera).toEqual(camera);
    s.redo();
    expect(useEditor.getState().project.camera).toEqual(camera);
  });
  it("creates each primitive", () => {
    for (const kind of ["cube", "sphere", "cylinder", "plane"] as const)
      useEditor.getState().add(kind);
    expect(useEditor.getState().project.objects.map((o) => o.type)).toEqual([
      "cube",
      "sphere",
      "cylinder",
      "plane",
    ]);
  });
  it("undoes and redoes mixed edits in sequence", () => {
    const s = useEditor.getState();
    s.add("cube");
    const id = useEditor.getState().selected!;
    const original = structuredClone(useEditor.getState().project);
    s.patch(id, {
      transform: {
        position: [3, 2, 1],
        rotation: [0, 45, 0],
        scale: [2, 1, 1],
      },
    });
    s.duplicate();
    expect(useEditor.getState().project.objects).toHaveLength(2);
    s.remove();
    expect(useEditor.getState().project.objects).toHaveLength(1);
    s.undo();
    s.undo();
    s.undo();
    expect(useEditor.getState().project).toEqual(original);
    s.redo();
    s.redo();
    s.redo();
    expect(useEditor.getState().project.objects[0].transform.position).toEqual([
      3, 2, 1,
    ]);
  });
  it("branches history after undo", () => {
    const s = useEditor.getState();
    s.add("cube");
    s.undo();
    s.add("sphere");
    expect(useEditor.getState().canRedo).toBe(false);
  });
  it("duplicates without aliasing", () => {
    const s = useEditor.getState();
    s.add("cube");
    s.duplicate();
    const [a, b] = useEditor.getState().project.objects;
    expect(a.id).not.toBe(b.id);
    expect(a.transform.position[0]).not.toBe(b.transform.position[0]);
  });
  it("protects locked objects", () => {
    const s = useEditor.getState();
    s.add("cube");
    const id = useEditor.getState().selected!;
    s.setLocked(id, true);
    s.remove();
    s.duplicate();
    s.patch(id, { name: "changed" });
    expect(useEditor.getState().project.objects).toHaveLength(1);
    expect(useEditor.getState().project.objects[0].name).not.toBe("changed");
  });
  it("resets history after open", () => {
    const s = useEditor.getState();
    s.add("cube");
    const restored = parseProject(
      serializeProject(useEditor.getState().project),
    );
    s.replace(restored);
    expect(useEditor.getState().canUndo).toBe(false);
    expect(useEditor.getState().project.objects).toHaveLength(1);
  });
  it("snaps positions consistently", () =>
    expect(snapPosition([0.12, 0.6, -0.3], 0.25)).toEqual([0, 0.5, -0.25]));
});
