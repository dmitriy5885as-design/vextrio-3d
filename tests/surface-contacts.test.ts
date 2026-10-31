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
import {
  tessellateFace,
  bodyVolume,
  transformAffine,
  classifyBody,
  type Vec3,
} from "@forma/geometry";
const state = () => {
  const p = useEditor.getState().project as ProjectV2;
  return { p, g: Object.values(p.geometries)[0] };
};
const rect: [Vec3, Vec3][] = [
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
];
beforeEach(() => {
  useMove.getState().cancel();
  useEditor.getState().setTool("select");
  useEditor.getState().replace(emptyProjectV2());
  usePrecision
    .getState()
    .configure({ enabled: false, path: [], planeName: "XZ", system: "world" });
});
async function draw(s: [Vec3, Vec3][]) {
  expect((await useEditor.getState().drawSegments([], s)).status).toBe(
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
async function applied(point: Vec3, delta: Vec3) {
  const r = await move(point, delta);
  expect(r.status, JSON.stringify(r)).toBe("applied");
}
it("joins a free endpoint to a face corner and preserves its face and material IDs", async () => {
  await draw(rect);
  await draw([
    [
      [5, 0, 4],
      [5, 0, 3],
    ],
  ]);
  const { p, g } = state(),
    f = Object.values(g.faces)[0];
  await applied([5, 0, 3], [-1, 0, 0]);
  const after = state().g;
  expect(after.faces[f.id]).toBeDefined();
  expect(after.faces[f.id].frontMaterialId).toBe(f.frontMaterialId);
  expect(tessellateFace(after, after.faces[f.id]).area).toBeCloseTo(12, 8);
  expect(Object.keys(after.vertices)).toHaveLength(5);
  await history(p);
});
it("splits a real face boundary at a free endpoint without changing face area", async () => {
  await draw(rect);
  await draw([
    [
      [5, 0, 1.5],
      [6, 0, 1.5],
    ],
  ]);
  const { p, g } = state(),
    fid = Object.keys(g.faces)[0];
  await applied([5, 0, 1.5], [-1, 0, 0]);
  const a = state().g;
  expect(Object.keys(a.edges)).toHaveLength(6);
  expect(a.loops[a.faces[fid].outerLoopId].coedgeIds).toHaveLength(5);
  expect(tessellateFace(a, a.faces[fid]).area).toBeCloseTo(12, 8);
  await history(p);
});
it("a moved free line splits a stationary face into two six square metre faces", async () => {
  await draw(rect);
  await draw([
    [
      [5, 0, 1.5],
      [9, 0, 1.5],
    ],
  ]);
  const { p, g } = state(),
    e = Object.values(g.edges).find(
      (e) => g.vertices[e.start].position[0] >= 5,
    )!;
  const r = await useEditor.getState().editGeometry(
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
      delta: [-5, 0, 0],
      copy: false,
    },
  );
  expect(r.status, JSON.stringify(r)).toBe("applied");
  const after = state().g;
  expect(Object.keys(after.faces)).toHaveLength(2);
  for (const f of Object.values(after.faces)) {
    expect(tessellateFace(after, f).area).toBeCloseTo(6, 8);
    expect(f.frontMaterialId).toBe(Object.values(g.faces)[0].frontMaterialId);
    expect(f.backMaterialId).toBe(Object.values(g.faces)[0].backMaterialId);
  }
  await history(p);
});

it("attaches to an inner boundary without filling its opening", async () => {
  await draw(rect);
  await draw([
    [
      [1, 0, 1],
      [2, 0, 1],
    ],
    [
      [2, 0, 1],
      [2, 0, 2],
    ],
    [
      [2, 0, 2],
      [1, 0, 2],
    ],
    [
      [1, 0, 2],
      [1, 0, 1],
    ],
  ]);
  let { g } = state();
  const inner = Object.values(g.faces).find(
    (f) => tessellateFace(g, f).area < 2,
  )!;
  expect(
    (
      await useEditor.getState().editGeometry(
        {
          definitionId: g.ownerDefinitionId,
          geometryId: g.id,
          kind: "face",
          entityId: inner.id,
          occurrencePath: [],
        },
        { kind: "delete-entities", entityIds: [inner.id] },
      )
    ).status,
  ).toBe("applied");
  await draw([
    [
      [2, 1, 1.5],
      [2, 2, 1.5],
    ],
  ]);
  const { p } = state();
  await applied([2, 1, 1.5], [0, -1, 0]);
  g = state().g;
  expect(Object.keys(g.faces)).toHaveLength(1);
  const f = Object.values(g.faces)[0];
  expect(f.innerLoopIds).toHaveLength(1);
  expect(g.loops[f.innerLoopIds[0]].coedgeIds).toHaveLength(5);
  expect(tessellateFace(g, f).area).toBeCloseTo(11, 8);
  await history(p);
});
it("divides a closed solid cap while keeping shared boundaries and a 24 cubic metre shell", async () => {
  await draw(rect);
  let { g } = state();
  const f = Object.values(g.faces)[0];
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
        {
          kind: "extrude-face",
          faceId: f.id,
          distance: 2,
          side: f.plane.normal[1] > 0 ? 1 : -1,
        },
      )
    ).status,
  ).toBe("applied");
  await draw([
    [
      [5, 2, 1.5],
      [9, 2, 1.5],
    ],
  ]);
  useEditor.getState().replace(parseProject(serializeProject(state().p)));
  const { p, g: before } = state(),
    e = Object.values(before.edges).find(
      (e) => before.vertices[e.start].position[0] >= 5,
    )!;
  const result = await useEditor.getState().editGeometry(
    {
      definitionId: before.ownerDefinitionId,
      geometryId: before.id,
      kind: "edge",
      entityId: e.id,
      occurrencePath: [],
    },
    {
      kind: "translate-entities",
      entities: [{ kind: "edge", id: e.id }],
      delta: [-5, 0, 0],
      copy: false,
    },
  );
  expect(result.status, JSON.stringify(result)).toBe("applied");
  g = state().g;
  expect(Object.keys(g.faces)).toHaveLength(7);
  expect(Object.keys(g.shells)).toHaveLength(1);
  expect(bodyVolume(g, Object.keys(g.bodies)[0])).toBeCloseTo(24, 7);
  await history(p);
});
it("a dangling interior wire is rejected atomically and retains redo", async () => {
  await draw(rect);
  await draw([
    [
      [5, 0, 1.5],
      [6, 0, 1.5],
    ],
  ]);
  await applied([6, 0, 1.5], [1, 0, 0]);
  useEditor.getState().undo();
  const before = useEditor.getState(),
    dirty = isDirty();
  const result = await move([5, 0, 1.5], [-3, 0, 0]);
  expect(result.status).toBe("rejected");
  const after = useEditor.getState();
  expect(after.project).toBe(before.project);
  expect(after.revision).toBe(before.revision);
  expect(after.canRedo).toBe(true);
  expect(isDirty()).toBe(dirty);
});

it("copies a free chord onto a face without moving the source", async () => {
  await draw(rect);
  await draw([
    [
      [5, 0, 1.5],
      [9, 0, 1.5],
    ],
  ]);
  const { p, g } = state(),
    e = Object.values(g.edges).find(
      (e) => g.vertices[e.start].position[0] >= 5,
    )!;
  const r = await useEditor.getState().editGeometry(
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
      delta: [-5, 0, 0],
      copy: true,
    },
  );
  expect(r.status, JSON.stringify(r)).toBe("applied");
  expect(state().g.edges[e.id]).toEqual(e);
  expect(Object.keys(state().g.faces)).toHaveLength(2);
  await history(p);
});
it("stationary face contacts respect rotated nonuniform group coordinates", async () => {
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
        ...rect,
        [
          [5, 0, 1.5],
          [6, 0, 1.5],
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
      return Math.abs(w[0] - 5) < 1e-7 && Math.abs(w[2] - 1.5) < 1e-7;
    })!;
  const r = await useEditor.getState().editGeometry(
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
      delta: [-1, 0, 0],
      copy: false,
    },
  );
  expect(r.status, JSON.stringify(r)).toBe("applied");
  const after = useEditor.getState().project as ProjectV2,
    m = after.geometries[g.id];
  expect(Object.keys(m.faces)).toHaveLength(1);
  expect(Object.keys(m.edges)).toHaveLength(6);
  expect(after.nodes).toEqual(p.nodes);
  expect(after.geometries["native/geometry"]).toEqual(
    p.geometries["native/geometry"],
  );
  await history(p);
});
it("rejects a free edge piercing a face interior without a boundary connection", async () => {
  await draw(rect);
  await draw([
    [
      [2, 1, 1.5],
      [2, 2, 1.5],
    ],
  ]);
  const before = useEditor.getState();
  const r = await move([2, 1, 1.5], [0, -2, 0]);
  expect(r.status).toBe("rejected");
  expect(useEditor.getState().project).toBe(before.project);
  expect(useEditor.getState().revision).toBe(before.revision);
});

it("an attached free wire does not falsely certify a closed solid body", async () => {
  await draw(rect);
  let { g } = state();
  const f = Object.values(g.faces)[0];
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
        {
          kind: "extrude-face",
          faceId: f.id,
          distance: 2,
          side: f.plane.normal[1] > 0 ? 1 : -1,
        },
      )
    ).status,
  ).toBe("applied");
  await draw([
    [
      [5, 2, 1.5],
      [6, 2, 1.5],
    ],
  ]);
  await applied([5, 2, 1.5], [-1, 0, 0]);
  g = state().g;
  expect(Object.keys(g.faces)).toHaveLength(6);
  expect(Object.keys(g.shells)).toHaveLength(1);
  expect(classifyBody(g, Object.keys(g.bodies)[0])).toBe("non-manifold");
  expect(bodyVolume(g, Object.keys(g.bodies)[0])).toBeNull();
});

it("a moved chord through an existing opening does not fill the hole", async () => {
  await draw(rect);
  await draw([
    [
      [1, 0, 1],
      [2, 0, 1],
    ],
    [
      [2, 0, 1],
      [2, 0, 2],
    ],
    [
      [2, 0, 2],
      [1, 0, 2],
    ],
    [
      [1, 0, 2],
      [1, 0, 1],
    ],
  ]);
  let { g } = state();
  const inner = Object.values(g.faces).find(
    (f) => tessellateFace(g, f).area < 2,
  )!;
  expect(
    (
      await useEditor.getState().editGeometry(
        {
          definitionId: g.ownerDefinitionId,
          geometryId: g.id,
          kind: "face",
          entityId: inner.id,
          occurrencePath: [],
        },
        { kind: "delete-entities", entityIds: [inner.id] },
      )
    ).status,
  ).toBe("applied");
  await draw([
    [
      [-5, 0, 1.5],
      [-1, 0, 1.5],
    ],
  ]);
  const { p, g: before } = state(),
    e = Object.values(before.edges).find(
      (e) => before.vertices[e.start].position[0] < 0,
    )!;
  const r = await useEditor.getState().editGeometry(
    {
      definitionId: before.ownerDefinitionId,
      geometryId: before.id,
      kind: "edge",
      entityId: e.id,
      occurrencePath: [],
    },
    {
      kind: "translate-entities",
      entities: [{ kind: "edge", id: e.id }],
      delta: [5, 0, 0],
      copy: false,
    },
  );
  expect(r.status, JSON.stringify(r)).toBe("applied");
  g = state().g;
  expect(Object.keys(g.faces)).toHaveLength(2);
  expect(
    Object.values(g.faces).reduce((n, f) => n + tessellateFace(g, f).area, 0),
  ).toBeCloseTo(11, 8);
  await history(p);
});
