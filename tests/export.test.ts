import { it, expect } from "vitest";
import { exportGeometry } from "@forma/file-io";
import { useEditor } from "@forma/editor";
import { emptyProject, migrateProject, type ProjectV2 } from "@forma/document";
import { topologyProject, firstRef } from "./fixtures/v2-project";
import { cross, dot } from "@forma/geometry";
it("exports canonical solids to STL millimetres with consistent winding and exact volume", async () => {
  const p = topologyProject();
  useEditor.getState().replace(p);
  const ref = firstRef(p, "face");
  await useEditor
    .getState()
    .editGeometry(ref, {
      kind: "extrude-face",
      faceId: ref.entityId,
      distance: 3,
      side: 1,
    });
  const before = JSON.stringify(useEditor.getState().project),
    text = exportGeometry(useEditor.getState().project, "stl");
  const vertices = [...text.matchAll(/^vertex (.*)$/gm)].map(
    (m) => m[1].split(" ").map(Number) as [number, number, number],
  );
  let volume = 0;
  for (let i = 0; i < vertices.length; i += 3)
    volume += dot(vertices[i], cross(vertices[i + 1], vertices[i + 2])) / 6;
  expect(Math.abs(volume)).toBeCloseTo(33e9, 2);
  expect(text.match(/facet normal/g)).toHaveLength(32);
  expect(JSON.stringify(useEditor.getState().project)).toBe(before);
});
it("exports both visible component occurrences in OBJ metres and excludes hidden ones", () => {
  const p = topologyProject();
  useEditor.getState().replace(p);
  useEditor.getState().selectEntity(firstRef(p, "face"));
  useEditor.getState().groupScene();
  const key = useEditor.getState().topologySelection!.occurrencePath[0];
  useEditor.getState().copyInstance(key);
  const copy = useEditor.getState().topologySelection!.occurrencePath[0],
    current = useEditor.getState().project as ProjectV2;
  const both = exportGeometry(current, "obj");
  expect(both.match(/^f /gm)).toHaveLength(16);
  expect(both).toContain("# VEXTRIO 3D — metres");
  useEditor.getState().patchNode(copy, { visible: false });
  expect(
    exportGeometry(useEditor.getState().project, "obj").match(/^f /gm),
  ).toHaveLength(8);
});
it("refuses STL sheets and refuses silently dropping legacy primitives", () => {
  expect(() => exportGeometry(topologyProject(), "stl")).toThrow(/замкнутые/);
  const p = migrateProject(emptyProject());
  expect(() => exportGeometry(p, "obj")).toThrow();
});
