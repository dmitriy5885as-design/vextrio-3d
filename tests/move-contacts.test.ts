import { componentProject } from "./fixtures/v2-project";
import { beforeEach, it, expect } from "vitest";
import { useEditor, useMove, usePrecision, isDirty } from "@forma/editor";
import {
  emptyProjectV2,
  parseProject,
  serializeProject,
  type ProjectV2,
  definitionAtPath,
  occurrenceMatrix,
} from "@forma/document";
import { tessellateFace, transformAffine, type Vec3 } from "@forma/geometry";
const state = () => {
  const p = useEditor.getState().project as ProjectV2;
  return { p, g: Object.values(p.geometries)[0] };
};
beforeEach(() => {
  useMove.getState().cancel();
  useEditor.getState().setTool("select");
  useEditor.getState().replace(emptyProjectV2());
  usePrecision
    .getState()
    .configure({ enabled: false, path: [], planeName: "XZ", system: "world" });
});
async function draw(segments: [Vec3, Vec3][]) {
  expect((await useEditor.getState().drawSegments([], segments)).status).toBe(
    "applied",
  );
}
async function move(point: Vec3, delta: Vec3) {
  const { g } = state(),
    v = Object.values(g.vertices).find((v) =>
      v.position.every((n, i) => Math.abs(n - point[i]) < 1e-8),
    )!;
  return useEditor.getState().editGeometry(
    {
      definitionId: g.ownerDefinitionId,
      geometryId: g.id,
      kind: "vertex",
      entityId: v.id,
      occurrencePath: [],
    },
    {
      kind: "translate-entities",
      entities: [{ kind: "vertex", id: v.id }],
      delta,
      copy: false,
    },
  );
}
async function history(before: ProjectV2) {
  const { p } = state();
  expect((parseProject(serializeProject(p)) as ProjectV2).geometries).toEqual(
    p.geometries,
  );
  useEditor.getState().undo();
  expect(useEditor.getState().project).toEqual(before);
  useEditor.getState().redo();
  expect(useEditor.getState().project).toEqual(p);
}
it("welds a moved endpoint to an existing vertex with lineage and exact history", async () => {
  await draw([
    [
      [0, 0, 0],
      [1, 0, 0],
    ],
    [
      [2, 0, 0],
      [2, 0, 2],
    ],
  ]);
  const { p } = state();
  const result = await move([1, 0, 0], [1, 0, 0]);
  expect(result.status, JSON.stringify(result)).toBe("applied");
  const { g } = state();
  expect(Object.keys(g.vertices)).toHaveLength(3);
  expect(Object.keys(g.edges)).toHaveLength(2);
  expect(
    state().p.provenance.some(
      (l) => l.kind === "vertex" && l.reason === "merge",
    ),
  ).toBe(true);
  await history(p);
});
it("splits an existing edge at a moved endpoint into a real T junction", async () => {
  await draw([
    [
      [0, 0, 0],
      [4, 0, 0],
    ],
    [
      [2, 0, 2],
      [2, 0, 1],
    ],
  ]);
  const { p, g: old } = state();
  const result = await move([2, 0, 1], [0, 0, -1]);
  expect(result.status, JSON.stringify(result)).toBe("applied");
  const { g } = state();
  expect(Object.keys(g.vertices)).toHaveLength(4);
  expect(Object.keys(g.edges)).toHaveLength(3);
  const v = Object.values(g.vertices).find(
    (v) => v.position[0] === 2 && v.position[2] === 0,
  )!;
  expect(
    Object.values(g.edges).filter((e) => e.start === v.id || e.end === v.id),
  ).toHaveLength(3);
  expect(
    state().p.provenance.some(
      (l) =>
        l.kind === "edge" && l.reason === "split" && old.edges[l.retiredId],
    ),
  ).toBe(true);
  await history(p);
});
it("moving a wire endpoint closes a genuine four by three face", async () => {
  await draw([
    [
      [0, 0, 0],
      [4, 0, 0],
    ],
    [
      [4, 0, 0],
      [4, 0, 3],
    ],
    [
      [4, 0, 3],
      [0, 0, 3],
    ],
    [
      [0, 0, 3],
      [0, 0, 1],
    ],
  ]);
  const { p } = state();
  expect((await move([0, 0, 1], [0, 0, -1])).status).toBe("applied");
  const { g } = state();
  expect(Object.keys(g.vertices)).toHaveLength(4);
  expect(Object.keys(g.edges)).toHaveLength(4);
  expect(Object.keys(g.faces)).toHaveLength(1);
  expect(tessellateFace(g, Object.values(g.faces)[0]).area).toBeCloseTo(12, 8);
  await history(p);
});
it("a collapsed edge rejects atomically and preserves redo", async () => {
  await draw([
    [
      [0, 0, 0],
      [1, 0, 0],
    ],
  ]);
  const result = await move([1, 0, 0], [1, 0, 0]);
  expect(result.status, JSON.stringify(result)).toBe("applied");
  useEditor.getState().undo();
  const before = useEditor.getState(),
    dirty = isDirty();
  expect((await move([1, 0, 0], [-1, 0, 0])).status).toBe("rejected");
  const after = useEditor.getState();
  expect(after.project).toBe(before.project);
  expect(after.revision).toBe(before.revision);
  expect(after.canRedo).toBe(true);
  expect(isDirty()).toBe(dirty);
});
it("skew lines stay disconnected", async () => {
  await draw([
    [
      [0, 0, 0],
      [4, 0, 0],
    ],
    [
      [2, 1, 2],
      [2, 1, 1],
    ],
  ]);
  expect((await move([2, 1, 1], [0, 0, -2])).status).toBe("applied");
  const { g } = state();
  expect(Object.keys(g.vertices)).toHaveLength(4);
  expect(Object.keys(g.edges)).toHaveLength(2);
});

it("moving a whole line through another creates an X junction", async () => {
  await draw([
    [
      [0, 0, 0],
      [4, 0, 0],
    ],
    [
      [2, 0, 1],
      [2, 0, 3],
    ],
  ]);
  const { p, g } = state(),
    e = Object.values(g.edges).find(
      (e) => g.vertices[e.start].position[2] > 0,
    )!;
  const result = await useEditor.getState().editGeometry(
    {
      definitionId: g.ownerDefinitionId,
      geometryId: g.id,
      kind: "edge",
      entityId: e.id,
      occurrencePath: [],
    },
    {
      kind: "translate-entities",
      entities: [{ kind: "edge", id: e.id }],
      delta: [0, 0, -2],
      copy: false,
    },
  );
  expect(result.status, JSON.stringify(result)).toBe("applied");
  expect(Object.keys(state().g.vertices)).toHaveLength(5);
  expect(Object.keys(state().g.edges)).toHaveLength(4);
  await history(p);
});
it("overlapping translated lines deduplicate without losing history", async () => {
  await draw([
    [
      [0, 0, 0],
      [4, 0, 0],
    ],
    [
      [0, 0, 1],
      [4, 0, 1],
    ],
  ]);
  const { p, g } = state(),
    e = Object.values(g.edges).find(
      (e) => g.vertices[e.start].position[2] === 1,
    )!;
  const result = await useEditor.getState().editGeometry(
    {
      definitionId: g.ownerDefinitionId,
      geometryId: g.id,
      kind: "edge",
      entityId: e.id,
      occurrencePath: [],
    },
    {
      kind: "translate-entities",
      entities: [{ kind: "edge", id: e.id }],
      delta: [0, 0, -1],
      copy: false,
    },
  );
  expect(result.status, JSON.stringify(result)).toBe("applied");
  expect(Object.keys(state().g.vertices)).toHaveLength(2);
  expect(Object.keys(state().g.edges)).toHaveLength(1);
  await history(p);
});
it("copies a wire into a partial overlap using one reversible command", async () => {
  await draw([
    [
      [0, 0, 0],
      [2, 0, 0],
    ],
  ]);
  const { p, g } = state(),
    e = Object.values(g.edges)[0];
  const result = await useEditor.getState().editGeometry(
    {
      definitionId: g.ownerDefinitionId,
      geometryId: g.id,
      kind: "edge",
      entityId: e.id,
      occurrencePath: [],
    },
    {
      kind: "translate-entities",
      entities: [{ kind: "edge", id: e.id }],
      delta: [1, 0, 0],
      copy: true,
    },
  );
  expect(result.status, JSON.stringify(result)).toBe("applied");
  expect(Object.keys(state().g.vertices)).toHaveLength(4);
  expect(Object.keys(state().g.edges)).toHaveLength(3);
  await history(p);
});
it("an unrelated wire move does not refill a previously deleted face", async () => {
  await draw([
    [
      [0, 0, 0],
      [4, 0, 0],
    ],
    [
      [4, 0, 0],
      [4, 0, 3],
    ],
    [
      [4, 0, 3],
      [0, 0, 3],
    ],
    [
      [0, 0, 3],
      [0, 0, 0],
    ],
    [
      [6, 0, 0],
      [7, 0, 0],
    ],
  ]);
  const { g } = state(),
    f = Object.values(g.faces)[0];
  expect(
    (
      await useEditor.getState().editGeometry(
        {
          definitionId: g.ownerDefinitionId,
          geometryId: g.id,
          kind: "face",
          entityId: f.id,
          occurrencePath: [],
        },
        { kind: "delete-entities", entityIds: [f.id] },
      )
    ).status,
  ).toBe("applied");
  expect((await move([7, 0, 0], [1, 0, 0])).status).toBe("applied");
  expect(Object.keys(state().g.faces)).toHaveLength(0);
});

it("wire contacts use physical tolerance", async () => {
  await draw([
    [
      [0, 0, 0],
      [1, 0, 0],
    ],
    [
      [2, 0, 0],
      [2, 0, 2],
    ],
  ]);
  expect((await move([1, 0, 0], [1 + 5e-8, 0, 0])).status).toBe("applied");
  expect(Object.keys(state().g.vertices)).toHaveLength(3);
});

it("joins wires in a rotated nonuniform group without changing neighbouring components", async () => {
  const doc = parseProject(serializeProject(componentProject())) as ProjectV2,
    node = doc.nodes["instance/group"];
  if (node.kind === "legacy-primitive") throw Error("fixture");
  node.transform.scale = [2, 3, 4];
  node.transform.rotation = [0, 0, Math.sin(0.2), Math.cos(0.2)];
  useEditor.getState().replace(doc);
  const path = [node.id];
  expect(
    (
      await useEditor.getState().drawSegments(path, [
        [
          [0, 0, 0],
          [4, 0, 0],
        ],
        [
          [2, 0, 2],
          [2, 0, 1],
        ],
      ])
    ).status,
  ).toBe("applied");
  const p = useEditor.getState().project as ProjectV2,
    did = definitionAtPath(p, path),
    g = p.geometries[p.definitions[did].geometryId!],
    matrix = occurrenceMatrix(p, path),
    v = Object.values(g.vertices).find((v) => {
      const w = transformAffine(v.position, matrix);
      return Math.abs(w[0] - 2) < 1e-7 && Math.abs(w[2] - 1) < 1e-7;
    })!;
  const result = await useEditor.getState().editGeometry(
    {
      definitionId: did,
      geometryId: g.id,
      kind: "vertex",
      entityId: v.id,
      occurrencePath: path,
    },
    {
      kind: "translate-entities",
      entities: [{ kind: "vertex", id: v.id }],
      delta: [0, 0, -1],
      copy: false,
    },
  );
  expect(result.status, JSON.stringify(result)).toBe("applied");
  const after = useEditor.getState().project as ProjectV2;
  expect(Object.keys(after.geometries[g.id].edges)).toHaveLength(3);
  expect(after.geometries["native/geometry"]).toEqual(
    p.geometries["native/geometry"],
  );
  expect(after.nodes).toEqual(p.nodes);
  await history(p);
});
