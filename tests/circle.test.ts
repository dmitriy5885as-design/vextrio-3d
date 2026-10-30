import { beforeEach, expect, it } from "vitest";
import { sketchSegments } from "@forma/tools";
import { useEditor, usePrecision, sketchController } from "@forma/editor";
import {
  emptyProjectV2,
  emptyProject,
  serializeProject,
  parseProject,
  occurrenceMatrix,
  type ProjectV2,
} from "@forma/document";
import { workPlane } from "@forma/snapping";
import {
  add,
  multiply,
  subtract,
  length,
  dot,
  tessellateFace,
  bodyVolume,
  classifyBody,
  transformAffine,
  type Vec3,
} from "@forma/geometry";
import { componentProject } from "./fixtures/v2-project";
const area = (n: number, r: number) =>
  (n * r * r * Math.sin((2 * Math.PI) / n)) / 2;
beforeEach(() => {
  useEditor.getState().setTool("select");
  useEditor.getState().replace(emptyProjectV2());
  usePrecision
    .getState()
    .configure({ planeName: "XZ", path: [], system: "world" });
  sketchController.setCircleSides(24, workPlane("XZ"));
});
it.each(["XY", "XZ", "YZ"] as const)(
  "builds a closed equal-radius circle on %s",
  (name) => {
    const plane = workPlane(name),
      center: Vec3 = [2, 3, 4],
      target = add(center, multiply(plane.u, 2)),
      segments = sketchSegments("circle", center, target, plane);
    expect(segments).toHaveLength(24);
    segments.forEach(([a, b], i) => {
      expect(length(subtract(a, center))).toBeCloseTo(2, 12);
      expect(dot(subtract(a, center), plane.normal)).toBeCloseTo(0, 12);
      expect(b).toEqual(segments[(i + 1) % 24][0]);
    });
  },
);
it.each([3, 8, 24, 48, 128])(
  "creates actual editable polygon topology with %s segments",
  async (n) => {
    const segments = sketchSegments(
      "circle",
      [0, 0, 0],
      [1, 0, 0],
      workPlane("XY"),
      1e-7,
      n,
    );
    const result = await useEditor.getState().drawSegments([], segments);
    expect(result.status, JSON.stringify(result)).toBe("applied");
    const p = useEditor.getState().project as ProjectV2,
      g = Object.values(p.geometries)[0];
    expect(Object.keys(g.vertices)).toHaveLength(n);
    expect(Object.keys(g.edges)).toHaveLength(n);
    expect(Object.keys(g.faces)).toHaveLength(1);
    expect(tessellateFace(g, Object.values(g.faces)[0]).area).toBeCloseTo(
      area(n, 1),
      9,
    );
  },
);
it("finishes a circle as one reversible command and roundtrips exact IDs", async () => {
  useEditor.getState().setTool("circle");
  const before = useEditor.getState().project;
  await sketchController.click([0, 0, 0], workPlane("XZ"), "center");
  sketchController.move([1, 0, 0], workPlane("XZ"));
  expect(useEditor.getState().project).toBe(before);
  expect(useEditor.getState().canUndo).toBe(false);
  await sketchController.click([1, 0, 0], workPlane("XZ"), "radius");
  expect(sketchController.state.phase).toBe("Finish");
  expect(sketchController.state.tool).toBe("circle");
  const after = useEditor.getState().project;
  await sketchController.click([1, 0, 0], workPlane("XZ"), "radius");
  expect(useEditor.getState().project).toBe(after);
  expect(parseProject(serializeProject(after))).toEqual(
    JSON.parse(JSON.stringify(after)),
  );
  useEditor.getState().undo();
  expect(useEditor.getState().project).toEqual(before);
  useEditor.getState().redo();
  expect(useEditor.getState().project).toEqual(after);
});
it("rejects zero, off-plane, nonfinite and unsupported segment inputs without changing history", () => {
  const p = useEditor.getState().project,
    plane = workPlane("XY");
  for (const target of [
    [0, 0, 0],
    [1, 0, 1],
    [NaN, 0, 0],
  ] as Vec3[])
    expect(() => sketchSegments("circle", [0, 0, 0], target, plane)).toThrow();
  for (const n of [0, 2, 3.5, 129, NaN])
    expect(() =>
      sketchSegments("circle", [0, 0, 0], [1, 0, 0], plane, 1e-7, n),
    ).toThrow();
  expect(useEditor.getState().project).toBe(p);
  expect(useEditor.getState().canUndo).toBe(false);
});
it("changing resolution recomputes preview without committing or accepting an invalid count", async () => {
  useEditor.getState().setTool("circle");
  const p = useEditor.getState().project,
    plane = workPlane("XZ");
  await sketchController.click([0, 0, 0], plane, "center");
  sketchController.move([1, 0, 0], plane);
  sketchController.setCircleSides(48, plane);
  expect(sketchController.state.segments).toHaveLength(48);
  sketchController.setCircleSides(200, plane);
  expect(sketchController.state.circleSides).toBe(48);
  expect(sketchController.state.error).not.toBe("");
  sketchController.cancel();
  expect(useEditor.getState().project).toBe(p);
  expect(useEditor.getState().canUndo).toBe(false);
});
it("extrudes the native circle into a real closed cylinder approximation", async () => {
  await useEditor
    .getState()
    .drawSegments(
      [],
      sketchSegments("circle", [0, 0, 0], [1, 0, 0], workPlane("XZ")),
    );
  const p = useEditor.getState().project as ProjectV2,
    g = Object.values(p.geometries)[0],
    f = Object.values(g.faces)[0];
  const r = await useEditor.getState().editGeometry(
    {
      definitionId: g.ownerDefinitionId,
      geometryId: g.id,
      entityId: f.id,
      kind: "face",
      occurrencePath: [],
    },
    { kind: "extrude-face", faceId: f.id, distance: 2, side: 1 },
  );
  expect(r.status, JSON.stringify(r)).toBe("applied");
  const m = (useEditor.getState().project as ProjectV2).geometries[g.id],
    body = Object.values(m.bodies)[0];
  expect(classifyBody(m, body.id)).toBe("closed-shell");
  expect(bodyVolume(m, body.id)).toBeCloseTo(2 * area(24, 1), 9);
  expect(Object.keys(m.vertices)).toHaveLength(48);
  expect(Object.keys(m.edges)).toHaveLength(72);
  expect(Object.keys(m.faces)).toHaveLength(26);
});
it("keeps a physical radius inside a scaled group and leaves other contexts untouched", async () => {
  const p = componentProject(),
    node = p.nodes["instance/group"];
  if (node.kind === "legacy-primitive") throw Error("fixture");
  node.transform.scale = [2, 3, 4];
  useEditor.getState().replace(p);
  const before = structuredClone(p.geometries);
  const r = await useEditor
    .getState()
    .drawSegments(
      [node.id],
      sketchSegments("circle", [0, 0, 0], [1, 0, 0], workPlane("XZ")),
    );
  expect(r.status, JSON.stringify(r)).toBe("applied");
  const after = useEditor.getState().project as ProjectV2;
  expect(after.geometries["native/geometry"]).toEqual(
    before["native/geometry"],
  );
  expect(after.nodes).toEqual(p.nodes);
  const gid = after.definitions[node.definitionId].geometryId!,
    g = after.geometries[gid],
    matrix = occurrenceMatrix(after, [node.id]);
  for (const v of Object.values(g.vertices))
    expect(length(transformAffine(v.position, matrix))).toBeCloseTo(1, 9);
});
it("requires explicit v1 migration before activating C", () => {
  useEditor.getState().replace(emptyProject());
  useEditor.getState().setTool("circle");
  expect(useEditor.getState().tool).toBe("select");
  expect(useEditor.getState().project.schemaVersion).toBe(1);
});
it("splits the circular face with a real diameter and keeps its total area", async () => {
  await useEditor
    .getState()
    .drawSegments(
      [],
      sketchSegments("circle", [0, 0, 0], [1, 0, 0], workPlane("XY")),
    );
  const r = await useEditor.getState().drawSegments(
    [],
    [
      [
        [-2, 0, 0],
        [2, 0, 0],
      ],
    ],
  );
  expect(r.status, JSON.stringify(r)).toBe("applied");
  const g = Object.values(
      (useEditor.getState().project as ProjectV2).geometries,
    )[0],
    faces = Object.values(g.faces);
  expect(faces).toHaveLength(2);
  for (const f of faces)
    expect(tessellateFace(g, f).area).toBeCloseTo(area(24, 1) / 2, 9);
});
it("redrawing the same circle is a no-op without duplicate edges or a new history state", async () => {
  const segments = sketchSegments(
    "circle",
    [0, 0, 0],
    [1, 0, 0],
    workPlane("XY"),
  );
  await useEditor.getState().drawSegments([], segments);
  const before = useEditor.getState();
  const r = await useEditor.getState().drawSegments([], segments);
  expect(r.status).toBe("noop");
  expect(useEditor.getState().project).toBe(before.project);
  expect(useEditor.getState().revision).toBe(before.revision);
});
