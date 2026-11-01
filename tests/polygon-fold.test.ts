import { foldRegions } from "../packages/geometry/src/fold-regions";
import { beforeEach, it, expect } from "vitest";
import { useEditor, usePrecision, useMove } from "@forma/editor";
import {
  emptyProjectV2,
  geometryContext,
  parseProject,
  serializeProject,
  occurrenceMatrix,
  type ProjectV2,
} from "@forma/document";
import {
  tessellateFace,
  bodyVolume,
  transformAffine,
  tessellationArea,
  type Vec3,
} from "@forma/geometry";
import { componentProject } from "./fixtures/v2-project";
const state = () => {
  const p = useEditor.getState().project as ProjectV2,
    g = Object.values(p.geometries)[0],
    f = Object.values(g.faces)[0];
  return {
    p,
    g,
    f,
    context: geometryContext(p, g.id, true, []),
    ref: {
      definitionId: g.ownerDefinitionId,
      geometryId: g.id,
      kind: "face" as const,
      entityId: f.id,
      occurrencePath: [],
    },
  };
};
beforeEach(() => {
  useEditor.getState().setTool("select");
  useMove.getState().cancel();
  useEditor.getState().replace(emptyProjectV2());
  usePrecision
    .getState()
    .configure({ enabled: false, path: [], planeName: "XZ", system: "world" });
});

const hex: Vec3[] = [
  [0, 0, 0],
  [4, 0, 0],
  [5, 0, 2],
  [4, 0, 4],
  [0, 0, 4],
  [-1, 0, 2],
];
async function draw(points: Vec3[]) {
  return useEditor.getState().drawSegments(
    [],
    points.map((a, i) => [a, points[(i + 1) % points.length]]),
  );
}
async function lift(point: Vec3) {
  const { g, ref } = state(),
    v = Object.values(g.vertices).find((v) =>
      v.position.every((n, i) => Math.abs(n - point[i]) < 1e-7),
    )!;
  return useEditor.getState().editGeometry(
    { ...ref, kind: "vertex", entityId: v.id },
    {
      kind: "translate-entities",
      entities: [{ kind: "vertex", id: v.id }],
      delta: [0, 1, 0],
      copy: false,
    },
  );
}
it("folds a hexagon into one planar pentagon and one lifted triangle without redundant edges", async () => {
  await draw(hex);
  const { p, g, f } = state();
  expect((await lift([5, 0, 2])).status).toBe("applied");
  const after = useEditor.getState().project as ProjectV2,
    m = after.geometries[g.id];
  expect(Object.keys(m.vertices)).toHaveLength(6);
  expect(Object.keys(m.edges)).toHaveLength(7);
  expect(Object.keys(m.faces)).toHaveLength(2);
  const areas = Object.values(m.faces)
    .map((f) => tessellateFace(m, f).area)
    .sort((a, b) => a - b);
  expect(areas[0]).toBeCloseTo(2 * Math.sqrt(2), 8);
  expect(areas[1]).toBeCloseTo(18, 8);
  expect(
    Object.values(m.faces)
      .map((f) => m.loops[f.outerLoopId].coedgeIds.length)
      .sort(),
  ).toEqual([3, 5]);
  for (const [id, e] of Object.entries(g.edges)) expect(m.edges[id]).toEqual(e);
  for (const face of Object.values(m.faces)) {
    expect(face.frontMaterialId).toBe(f.frontMaterialId);
    expect(face.backMaterialId).toBe(f.backMaterialId);
  }
  const reopened = (parseProject(serializeProject(after)) as ProjectV2)
    .geometries;
  expect(reopened).toEqual(after.geometries);
  useEditor.getState().undo();
  expect(useEditor.getState().project).toEqual(p);
  useEditor.getState().redo();
  expect(useEditor.getState().project).toEqual(after);
});
it("keeps every collinear boundary vertex when a different corner is raised", async () => {
  await draw([
    [0, 0, 0],
    [4, 0, 0],
    [4, 0, 3],
    [2, 0, 3],
    [0, 0, 3],
  ]);
  const { g } = state();
  expect((await lift([4, 0, 3])).status).toBe("applied");
  const m = (useEditor.getState().project as ProjectV2).geometries[g.id];
  expect(Object.keys(m.vertices)).toHaveLength(5);
  expect(Object.keys(m.edges)).toHaveLength(6);
  expect(Object.keys(m.faces)).toHaveLength(2);
  for (const [id, e] of Object.entries(g.edges)) expect(m.edges[id]).toEqual(e);
});
it("raises a collinear middle boundary point into a valid three-region fold", async () => {
  await draw([
    [0, 0, 0],
    [4, 0, 0],
    [4, 0, 3],
    [2, 0, 3],
    [0, 0, 3],
  ]);
  const { g } = state();
  expect((await lift([2, 0, 3])).status).toBe("applied");
  const m = (useEditor.getState().project as ProjectV2).geometries[g.id];
  expect(Object.keys(m.vertices)).toHaveLength(5);
  expect(Object.keys(m.edges)).toHaveLength(7);
  expect(Object.keys(m.faces)).toHaveLength(3);
  expect(
    Object.values(m.faces).reduce((n, f) => n + tessellateFace(m, f).area, 0),
  ).toBeGreaterThan(12);
});
it("retains a single unmodified planar region in a 16-sided polygon", async () => {
  const points = Array.from(
    { length: 16 },
    (_, i) =>
      [
        2 * Math.cos((i * Math.PI) / 8),
        0,
        2 * Math.sin((i * Math.PI) / 8),
      ] as Vec3,
  );
  await draw(points);
  const { g } = state();
  expect((await lift(points[0])).status).toBe("applied");
  const m = (useEditor.getState().project as ProjectV2).geometries[g.id];
  expect(Object.keys(m.faces)).toHaveLength(2);
  expect(Object.keys(m.edges)).toHaveLength(17);
  expect(Object.keys(m.vertices)).toHaveLength(16);
});
it("folds a concave six-vertex L without filling its exterior notch", async () => {
  const points: Vec3[] = [
    [0, 0, 0],
    [4, 0, 0],
    [4, 0, 1],
    [1, 0, 1],
    [1, 0, 4],
    [0, 0, 4],
  ];
  await draw(points);
  const { g } = state();
  expect((await lift([4, 0, 1])).status).toBe("applied");
  const m = (useEditor.getState().project as ProjectV2).geometries[g.id];
  expect(Object.keys(m.vertices)).toHaveLength(6);
  expect(Object.keys(m.faces).length).toBeGreaterThan(1);
  for (const f of Object.values(m.faces))
    expect(tessellateFace(m, f).area).toBeGreaterThan(0);
});
it("preserves physical areas for a polygon in a rotated nonuniform group", async () => {
  const doc = componentProject(),
    node = doc.nodes["instance/group"];
  if (node.kind === "legacy-primitive") throw Error("fixture");
  node.transform.scale = [2, 3, 4];
  node.transform.rotation = [0, 0, Math.sin(0.2), Math.cos(0.2)];
  useEditor.getState().replace(doc);
  await useEditor.getState().drawSegments(
    [node.id],
    hex.map((a, i) => [a, hex[(i + 1) % hex.length]]),
  );
  const p = useEditor.getState().project as ProjectV2,
    g = p.geometries[p.definitions[node.definitionId].geometryId!],
    matrix = occurrenceMatrix(p, [node.id]),
    v = Object.values(g.vertices).find((v) => {
      const q = transformAffine(v.position, matrix);
      return Math.abs(q[0] - 5) < 1e-7 && Math.abs(q[2] - 2) < 1e-7;
    })!,
    ref = {
      definitionId: g.ownerDefinitionId,
      geometryId: g.id,
      kind: "vertex" as const,
      entityId: v.id,
      occurrencePath: [node.id],
    };
  expect(
    (
      await useEditor.getState().editGeometry(ref, {
        kind: "translate-entities",
        entities: [{ kind: "vertex", id: v.id }],
        delta: [0, 1, 0],
        copy: false,
      })
    ).status,
  ).toBe("applied");
  const after = useEditor.getState().project as ProjectV2,
    m = after.geometries[g.id],
    areas = Object.values(m.faces)
      .map((f) => tessellationArea(tessellateFace(m, f), matrix))
      .sort((a, b) => a - b);
  expect(areas[0]).toBeCloseTo(2 * Math.sqrt(2), 7);
  expect(areas[1]).toBeCloseTo(18, 7);
  expect(after.geometries["native/geometry"]).toEqual(
    p.geometries["native/geometry"],
  );
  expect(after.nodes).toEqual(p.nodes);
});

it("bounds the polygon size and deterministically handles the 128-vertex boundary", () => {
  const n = 128,
    flat = Array.from(
      { length: n },
      (_, i) =>
        [Math.cos((i * 2 * Math.PI) / n), Math.sin((i * 2 * Math.PI) / n)] as [
          number,
          number,
        ],
    ),
    points = flat.map(([x, y], i) => [x, y, i === 0 ? 1 : 0] as Vec3),
    ids = flat.map((_, i) => "v/" + i),
    changed = new Set([ids[0]]);
  const first = foldRegions(flat, points, ids, changed, 1e-7);
  expect(first).toHaveLength(2);
  expect(foldRegions(flat, points, ids, changed, 1e-7)).toEqual(first);
  const limited = { remaining: 1 },
    snapshot = structuredClone(points);
  expect(() => foldRegions(flat, points, ids, changed, 1e-7, limited)).toThrow(
    /бюджет/,
  );
  expect(points).toEqual(snapshot);
  expect(new Set(first.flat()).size).toBe(128);
  expect(() =>
    foldRegions(
      [...flat, [2, 2]],
      [...points, [2, 2, 0]],
      [...ids, "extra"],
      changed,
      1e-7,
    ),
  ).toThrow(/128/);
});

it("folds a prism cap into planar regions while preserving shell closure and exact volume", async () => {
  await draw(hex);
  let { f, ref } = state();
  expect(
    (
      await useEditor.getState().editGeometry(ref, {
        kind: "extrude-face",
        faceId: f.id,
        distance: 3,
        side: 1,
      })
    ).status,
  ).toBe("applied");
  const { g } = state();
  expect((await lift([5, 3, 2])).status).toBe("applied");
  const m = (useEditor.getState().project as ProjectV2).geometries[g.id];
  expect(Object.keys(m.vertices)).toHaveLength(12);
  expect(Object.keys(m.edges)).toHaveLength(19);
  expect(Object.keys(m.faces)).toHaveLength(9);
  expect(bodyVolume(m, Object.keys(m.bodies)[0])).toBeCloseTo(60 + 2 / 3, 7);
});
