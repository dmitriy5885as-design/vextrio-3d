import { getLegacyObjects } from "@forma/document";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createObject,
  emptyProject,
  parseProject,
  serializeProject,
  validateProject,
} from "@forma/document";
import { useEditor, isObjectLocked } from "@forma/editor";
import manifest from "./fixtures/v1/manifest.json";
beforeEach(() => {
  useEditor.getState().replace(emptyProject());
});
describe("immutable golden v1 corpus", () => {
  it.each(manifest.files)(
    "opens and roundtrips $file without changing legacy IDs, placement, materials or source bytes",
    (entry) => {
      const url = new URL(`./fixtures/v1/${entry.file}`, import.meta.url),
        original = readFileSync(url);
      expect(createHash("sha256").update(original).digest("hex")).toBe(
        entry.sha256,
      );
      const project = parseProject(original.toString("utf8"));
      expect(project).toEqual(JSON.parse(original.toString("utf8")));
      useEditor.getState().replace(project);
      expect(
        getLegacyObjects(useEditor.getState().project).map((o) => o.id),
      ).toEqual([
        "legacy-cube",
        "legacy-sphere",
        "legacy-cylinder",
        "legacy-plane",
      ]);
      expect(
        getLegacyObjects(useEditor.getState().project).map(
          (o) => o.transform.position,
        ),
      ).toEqual([
        [8, 1, 0],
        [1.25, 1, -2],
        [-3, 1, 1],
        [0, 0, 0],
      ]);
      expect(getLegacyObjects(project)[1].parentId).toBe("legacy-cube");
      expect(getLegacyObjects(project).map((o) => o.material.color)).toEqual([
        "#3478f6",
        "#4dd5c0",
        "#a9c6e8",
        "#f2f5fa",
      ]);
      expect(getLegacyObjects(project)[2].locked).toBe(true);
      expect(getLegacyObjects(project)[3].visible).toBe(false);
      expect(
        parseProject(serializeProject(useEditor.getState().project)),
      ).toEqual(project);
      expect(readFileSync(url)).toEqual(original);
    },
  );
  it("can edit an unlocked legacy object and undo exactly without changing its parent interpretation", () => {
    const project = parseProject(
      readFileSync(new URL("./fixtures/v1/m.v3d", import.meta.url), "utf8"),
    );
    const s = useEditor.getState();
    s.replace(project);
    s.patch("legacy-sphere", { name: "Новое имя" });
    s.undo();
    expect(useEditor.getState().project).toEqual(project);
  });
});
it("validates 10000 linked parents iteratively and detects a cycle at the end", () => {
  const p = emptyProject();
  p.objects = Array.from({ length: 10000 }, (_, i) => ({
    ...createObject("cube"),
    id: `node-${i}`,
    parentId: i === 9999 ? null : `node-${i + 1}`,
  }));
  expect(() => validateProject(p)).not.toThrow();
  p.objects[9999].parentId = "node-0";
  expect(() => validateProject(p)).toThrow(/Циклическая/);
});
it("rejects edits through locked ancestors without reinterpreting legacy transforms", () => {
  const p = emptyProject(),
    parent = createObject("cube"),
    child = createObject("sphere");
  parent.transform.position = [10, 0, 0];
  parent.locked = true;
  child.transform.position = [1, 0, 0];
  child.parentId = parent.id;
  p.objects = [parent, child];
  const s = useEditor.getState();
  s.replace(p);
  s.select(child.id);
  expect(isObjectLocked(p, child.id)).toBe(true);
  const before = structuredClone(useEditor.getState().project);
  expect(s.patch(child.id, { name: "bypass" }).status).toBe("rejected");
  expect(s.setLocked(child.id, false).status).toBe("rejected");
  expect(s.remove().status).toBe("rejected");
  expect(s.duplicate().status).toBe("rejected");
  expect(useEditor.getState().project).toEqual(before);
  s.setLocked(parent.id, false);
  expect(s.patch(child.id, { name: "allowed" }).status).toBe("applied");
  expect(
    getLegacyObjects(useEditor.getState().project)[1].transform.position,
  ).toEqual([1, 0, 0]);
});
it.each([
  ["units", ["m"]],
  [
    "camera",
    {
      position: [9, 7, 10],
      target: [0, 0, 0],
      projection: ["perspective"],
      zoom: 1,
    },
  ],
])("rejects wrong runtime type for %s", (key, value) => {
  const p = Object.assign(emptyProject(), { [key as string]: value });
  expect(() => validateProject(p)).toThrow();
});
