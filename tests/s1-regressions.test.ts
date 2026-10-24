import { beforeEach, expect, it } from "vitest";
import { useEditor, isDirty } from "@forma/editor";
import { emptyProject, serializeProject } from "@forma/document";

beforeEach(() => useEditor.getState().replace(emptyProject()));
function checkpoint() {
  const s = useEditor.getState();
  return {
    project: structuredClone(s.project),
    selected: s.selected,
    tool: s.tool,
    dirty: isDirty(),
    revision: s.revision,
    savedSignature: s.savedSignature,
    canUndo: s.canUndo,
    canRedo: s.canRedo,
  };
}
it("rejects zero scale without changing document, selection, dirty or redo branch", () => {
  const s = useEditor.getState();
  s.add("cube");
  const id = useEditor.getState().selected!;
  s.patch(id, { name: "temporary" });
  s.undo();
  s.markSaved(JSON.stringify(useEditor.getState().project));
  const before = checkpoint();
  s.patch(id, {
    transform: { position: [0, 1, 0], rotation: [0, 0, 0], scale: [0, 1, 1] },
  });
  expect(checkpoint()).toEqual(before);
  expect(() => serializeProject(useEditor.getState().project)).not.toThrow();
  s.redo();
  expect(useEditor.getState().project.objects[0].name).toBe("temporary");
});
it("rejects mixed locked patch rather than treating locked key as authorization", () => {
  const s = useEditor.getState();
  s.add("cube");
  const id = useEditor.getState().selected!;
  s.setLocked(id, true);
  const before = checkpoint();
  const mixed = { locked: true, name: "bypass" };
  s.patch(id, mixed);
  expect(checkpoint()).toEqual(before);
  s.undo();
  expect(useEditor.getState().project.objects[0].locked).toBe(false);
});
it.each([0, -1, NaN, Infinity, -Infinity])(
  "rejects invalid scale %s on the shared mutation path",
  (scale) => {
    const s = useEditor.getState();
    s.add("cube");
    s.duplicate();
    s.undo();
    const before = checkpoint();
    s.mutate("invalid", (p) => {
      p.objects[0].transform.scale[0] = scale;
    });
    expect(checkpoint()).toEqual(before);
    s.redo();
    expect(useEditor.getState().project.objects).toHaveLength(2);
  },
);
it("keeps everything when the draft callback throws after changing it", () => {
  const s = useEditor.getState();
  s.add("cube");
  const before = checkpoint();
  expect(
    s.mutate("throw", (p) => {
      p.name = "leak";
      throw Error("expected");
    }).status,
  ).toBe("rejected");
  expect(checkpoint()).toEqual(before);
});
it("keeps redo on no-op and rejects invalid camera or replacement before clearing history", () => {
  const s = useEditor.getState();
  s.add("cube");
  s.undo();
  const before = checkpoint();
  s.mutate("noop", () => {});
  s.setCamera({ ...useEditor.getState().project.camera, zoom: 0 });
  const invalid = emptyProject();
  invalid.camera.position = [0, 0, 0];
  s.replace(invalid);
  expect(checkpoint()).toEqual(before);
  s.redo();
  expect(useEditor.getState().project.objects).toHaveLength(1);
});
it("cannot bypass locks through the general mutation callback", () => {
  const s = useEditor.getState();
  s.add("cube");
  const id = useEditor.getState().selected!;
  s.setLocked(id, true);
  const before = checkpoint();
  s.mutate("bypass", (p) => {
    p.objects[0].locked = false;
    p.objects[0].name = "bypass";
  });
  s.remove();
  s.duplicate();
  expect(checkpoint()).toEqual(before);
  s.setLocked(id, false);
  s.patch(id, { name: "allowed" });
  expect(useEditor.getState().project.objects[0].name).toBe("allowed");
  s.undo();
  s.undo();
  expect(useEditor.getState().project.objects[0].locked).toBe(true);
});
it("does not retain a draft reference held by a caller", () => {
  const s = useEditor.getState();
  let leaked = emptyProject();
  s.mutate("rename", (p) => {
    p.name = "accepted";
    leaked = p;
  });
  leaked.name = "late mutation";
  expect(useEditor.getState().project.name).toBe("accepted");
  s.undo();
  s.redo();
  expect(useEditor.getState().project.name).toBe("accepted");
});
it("validates runtime values before JSON could conceal them", () => {
  const s = useEditor.getState(),
    before = checkpoint();
  for (const extension of [
    NaN,
    Infinity,
    undefined,
    () => 1,
    new Map(),
    BigInt(1),
  ])
    s.mutate("invalid JSON", (p) => {
      Object.assign(p, { extension });
    });
  expect(checkpoint()).toEqual(before);
  s.mutate("bad units", (p) => Object.assign(p, { units: ["m"] }));
  expect(checkpoint()).toEqual(before);
});

it("guards nested operations and selection when a draft later throws", () => {
  const s = useEditor.getState();
  s.add("cube");
  s.duplicate();
  s.undo();
  const before = checkpoint();
  s.mutate("outer", (p) => {
    p.name = "draft";
    s.select(null);
    s.setTool("scale");
    s.replace(emptyProject("nested"));
    s.undo();
    s.setCamera({ ...p.camera, zoom: 2 });
    s.markSaved(JSON.stringify(p));
    s.add("sphere");
    throw Error("outer failure");
  });
  expect(checkpoint()).toEqual(before);
});
it("keeps accepted projects immutable outside commands", () => {
  const s = useEditor.getState();
  s.add("cube");
  expect(() => {
    useEditor.getState().project.objects[0].transform.scale[0] = 0;
  }).toThrow();
  expect(() => serializeProject(useEditor.getState().project)).not.toThrow();
});

it("rejects async draft callbacks without committing their partial mutation", async () => {
  const s = useEditor.getState(),
    before = checkpoint();
  const result = s.mutate("async", async (p) => {
    p.name = "early";
    await Promise.resolve();
    p.name = "late";
  });
  expect(result.status).toBe("rejected");
  await Promise.resolve();
  expect(checkpoint()).toEqual(before);
});
it("a confirmed older save leaves subsequent edits dirty and undo can return to the saved snapshot", () => {
  const s = useEditor.getState();
  s.add("cube");
  const signature = JSON.stringify(useEditor.getState().project);
  s.patch(useEditor.getState().selected!, { name: "new edit" });
  s.markSaved(signature);
  expect(isDirty()).toBe(true);
  s.undo();
  expect(isDirty()).toBe(false);
});
