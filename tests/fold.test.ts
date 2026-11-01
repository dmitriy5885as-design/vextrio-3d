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
  prepareVertexMove,
  validatePrepared as checkPrepared,
  tessellateFace,
  bodyVolume,
  transformAffine,
  tessellationArea,
  id,
  type Vec3,
} from "@forma/geometry";
import { componentProject } from "./fixtures/v2-project";
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

it("folds one raised rectangle corner into two real editable faces with split lineage and exact history", async () => {
  await useEditor.getState().drawSegments([], rect);
  const { p, g, f, ref } = state(),
    v = Object.values(g.vertices).find(
      (v) => v.position[0] === 4 && v.position[2] === 3,
    )!;
  const r = await useEditor.getState().editGeometry(
    { ...ref, kind: "vertex", entityId: v.id },
    {
      kind: "translate-entities",
      entities: [{ kind: "vertex", id: v.id }],
      delta: [0, 1, 0],
      copy: false,
    },
  );
  expect(r.status).toBe("applied");
  const after = useEditor.getState().project as ProjectV2,
    m = after.geometries[g.id];
  expect(Object.keys(m.vertices)).toHaveLength(4);
  expect(Object.keys(m.edges)).toHaveLength(5);
  expect(Object.keys(m.faces)).toHaveLength(2);
  expect(m.faces[f.id]).toBeUndefined();
  expect(
    Object.values(m.faces)
      .map((f) => tessellateFace(m, f).area)
      .sort((a, b) => a - b),
  ).toEqual([6, 6.5]);
  for (const [id, e] of Object.entries(g.edges)) expect(m.edges[id]).toEqual(e);
  for (const face of Object.values(m.faces)) {
    expect(face.frontMaterialId).toBe(f.frontMaterialId);
    expect(face.backMaterialId).toBe(f.backMaterialId);
  }
  expect(
    after.provenance.some(
      (l) =>
        l.kind === "face" &&
        l.retiredId === f.id &&
        l.reason === "split" &&
        l.descendants.length === 2,
    ),
  ).toBe(true);
  expect(
    (parseProject(serializeProject(after)) as ProjectV2).geometries,
  ).toEqual(after.geometries);
  useEditor.getState().undo();
  expect(useEditor.getState().project).toEqual(p);
  useEditor.getState().redo();
  expect(useEditor.getState().project).toEqual(after);
});
it("keeps shell and body incidence closed while raising one block corner", async () => {
  await useEditor.getState().drawSegments([], rect);
  let { ref, f } = state();
  await useEditor.getState().editGeometry(ref, {
    kind: "extrude-face",
    faceId: f.id,
    distance: 3,
    side: 1,
  });
  const { g } = state(),
    v = Object.values(g.vertices).find(
      (v) => v.position[0] === 4 && v.position[1] === 3 && v.position[2] === 3,
    )!;
  expect(
    (
      await useEditor.getState().editGeometry(
        { ...ref, kind: "vertex", entityId: v.id },
        {
          kind: "translate-entities",
          entities: [{ kind: "vertex", id: v.id }],
          delta: [0, 1, 0],
          copy: false,
        },
      )
    ).status,
  ).toBe("applied");
  const m = (useEditor.getState().project as ProjectV2).geometries[g.id];
  expect(Object.keys(m.vertices)).toHaveLength(8);
  expect(Object.keys(m.edges)).toHaveLength(13);
  expect(Object.keys(m.faces)).toHaveLength(7);
  expect(bodyVolume(m, Object.keys(m.bodies)[0])).toBeCloseTo(38, 8);
});
it("preview uses deterministic operation IDs without changing the source document", async () => {
  await useEditor.getState().drawSegments([], rect);
  const { p, g, context } = state(),
    v = Object.values(g.vertices).find(
      (v) => v.position[0] === 4 && v.position[2] === 3,
    )!,
    op = id<"operation">("fold-preview"),
    args = [{ vertexId: v.id, position: [4, 1, 3] as Vec3 }];
  const a = prepareVertexMove(g, args, context, op),
    b = prepareVertexMove(g, args, context, op);
  expect(a).toEqual(b);
  expect(checkPrepared(g, a, context, op).faces).toEqual(
    checkPrepared(g, b, context, op).faces,
  );
  expect(useEditor.getState().project).toBe(p);
});
it("does not introduce a crease for planar movement or values within tolerance", async () => {
  await useEditor.getState().drawSegments([], rect);
  const { g, context } = state(),
    v = Object.values(g.vertices)[0],
    op = id<"operation">("planar-move"),
    change = prepareVertexMove(
      g,
      [{ vertexId: v.id, position: [-1, 0, 0] }],
      context,
      op,
    );
  const m = checkPrepared(g, change, context, op);
  expect(Object.keys(m.faces)).toEqual(Object.keys(g.faces));
  expect(Object.keys(m.edges)).toEqual(Object.keys(g.edges));
  expect(change.lineage).toEqual([]);
});

it("chooses an interior diagonal for a concave quadrilateral", async () => {
  const points: Vec3[] = [
    [0, 0, 0],
    [4, 0, 0],
    [1, 0, 1],
    [0, 0, 3],
  ];
  await useEditor.getState().drawSegments(
    [],
    points.map((a, i) => [a, points[(i + 1) % 4]]),
  );
  const { g, ref } = state(),
    v = Object.values(g.vertices).find(
      (v) => v.position[0] === 1 && v.position[2] === 1,
    )!;
  expect(
    (
      await useEditor.getState().editGeometry(
        { ...ref, kind: "vertex", entityId: v.id },
        {
          kind: "translate-entities",
          entities: [{ kind: "vertex", id: v.id }],
          delta: [0, 1, 0],
          copy: false,
        },
      )
    ).status,
  ).toBe("applied");
  expect(
    Object.keys(
      (useEditor.getState().project as ProjectV2).geometries[g.id].faces,
    ),
  ).toHaveLength(2);
});
it("does not fold a perturbation below the geometry distance tolerance", async () => {
  await useEditor.getState().drawSegments([], rect);
  const { g, context } = state(),
    v = Object.values(g.vertices).find(
      (v) => v.position[0] === 4 && v.position[2] === 3,
    )!,
    op = id<"operation">("near-planar"),
    change = prepareVertexMove(
      g,
      [{ vertexId: v.id, position: [4, 1e-9, 3] }],
      context,
      op,
    );
  const m = checkPrepared(g, change, context, op);
  expect(Object.keys(m.faces)).toEqual(Object.keys(g.faces));
  expect(change.lineage).toEqual([]);
});

it("folds in physical coordinates under a rotated nonuniform group without changing its neighbour", async () => {
  const doc = componentProject(),
    node = doc.nodes["instance/group"];
  if (node.kind === "legacy-primitive") throw Error("fixture");
  node.transform.scale = [2, 3, 4];
  node.transform.rotation = [0, 0, Math.sin(0.2), Math.cos(0.2)];
  useEditor.getState().replace(doc);
  await useEditor.getState().drawSegments([node.id], rect);
  const before = useEditor.getState().project as ProjectV2,
    g = before.geometries[before.definitions[node.definitionId].geometryId!],
    matrix = occurrenceMatrix(before, [node.id]),
    v = Object.values(g.vertices).find((v) => {
      const p = transformAffine(v.position, matrix);
      return Math.abs(p[0] - 4) < 1e-7 && Math.abs(p[2] - 3) < 1e-7;
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
      await useEditor
        .getState()
        .editGeometry(ref, {
          kind: "translate-entities",
          entities: [{ kind: "vertex", id: v.id }],
          delta: [0, 1, 0],
          copy: false,
        })
    ).status,
  ).toBe("applied");
  const after = useEditor.getState().project as ProjectV2,
    m = after.geometries[g.id];
  expect(after.nodes).toEqual(before.nodes);
  expect(after.geometries["native/geometry"]).toEqual(
    before.geometries["native/geometry"],
  );
  expect(
    Object.values(m.faces)
      .map((f) => tessellationArea(tessellateFace(m, f), matrix))
      .sort((a, b) => a - b),
  ).toEqual([expect.closeTo(6, 7), expect.closeTo(6.5, 7)]);
});
it("rejects a fold through a separate face without writing partial topology", async () => {
  await useEditor.getState().drawSegments([], rect);
  const q: Vec3[] = [
    [2.5, 0.4, 1.5],
    [3.5, 0.4, 1.5],
    [3.5, 0.4, 2.5],
    [2.5, 0.4, 2.5],
  ];
  await useEditor.getState().drawSegments(
    [],
    q.map((a, i) => [a, q[(i + 1) % 4]]),
  );
  const { p, g, ref } = state(),
    v = Object.values(g.vertices).find(
      (v) => v.position[0] === 4 && v.position[2] === 3,
    )!;
  expect(
    (
      await useEditor
        .getState()
        .editGeometry(
          { ...ref, kind: "vertex", entityId: v.id },
          {
            kind: "translate-entities",
            entities: [{ kind: "vertex", id: v.id }],
            delta: [0, 1, 0],
            copy: false,
          },
        )
    ).status,
  ).toBe("rejected");
  expect(useEditor.getState().project).toBe(p);
});
it("rejects a crease already occupied by an unpartitioned source wire", async () => {
  await useEditor.getState().drawSegments([], rect);
  const { g, context } = state(),
    m = structuredClone(g),
    v = Object.values(g.vertices).find(
      (v) => v.position[0] === 4 && v.position[2] === 3,
    )!,
    a = Object.values(g.vertices).find(
      (v) => v.position[0] === 4 && v.position[2] === 0,
    )!,
    b = Object.values(g.vertices).find(
      (v) => v.position[0] === 0 && v.position[2] === 3,
    )!,
    eid = id<"edge">("occupied/diagonal");
  m.edges[eid] = { id: eid, start: a.id, end: b.id, curve: { kind: "line" } };
  Object.values(m.bodies)[0].edgeIds.push(eid);
  expect(() =>
    prepareVertexMove(
      m,
      [{ vertexId: v.id, position: [4, 1, 3] }],
      context,
      id("occupied-fold"),
    ),
  ).toThrow(/уже занята/);
});
