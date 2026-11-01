import { it, expect, beforeEach } from "vitest";
import {
  emptyGeometry,
  id,
  prepareSketch,
  validatePrepared,
  applyDelta,
  tessellateFace,
  prepareExtrusion,
  bodyVolume,
  classifyBody,
  placementMatrix,
  tessellationArea,
  type GeometryModel,
  type Vec3,
  type ValidationContext,
} from "@forma/geometry";
import {
  emptyProjectV2,
  serializeProject,
  parseProject,
  validateProject,
  geometryContext,
  type ProjectV2,
} from "@forma/document";
import { useEditor, usePrecision } from "@forma/editor";
import { topologyProject } from "./fixtures/v2-project";
let op = 0;
const ctx: ValidationContext = {
  ownerDefinitionId: "v2/root",
  materialIds: new Set(["material/main", "material/other"]),
};
const ring = (p: Vec3[]): [Vec3, Vec3][] =>
  p.map((a, i) => [a, p[(i + 1) % p.length]]);
const rect = ring([
  [0, 0, 0],
  [4, 0, 0],
  [4, 3, 0],
  [0, 3, 0],
]);
function insert(m: GeometryModel, segments: [Vec3, Vec3][], context = ctx) {
  const operation = id<"operation">("insert/" + op++);
  return validatePrepared(
    m,
    prepareSketch(
      m,
      { kind: "insert-segments", segments, plane: null },
      context,
      operation,
    ),
    context,
    operation,
  );
}
function base() {
  return insert(emptyGeometry(id("geometry/main"), id("v2/root")), rect);
}
function uses(m: GeometryModel, eid: string) {
  return Object.values(m.coedges).filter((c) => c.edgeId === eid).length;
}
const internal = (m: GeometryModel) =>
  Object.keys(m.edges).filter((eid) => uses(m, eid) === 2);
function erase(m: GeometryModel, ids: string[], context = ctx) {
  const operation = id<"operation">("erase/" + op++),
    change = prepareSketch(
      m,
      { kind: "delete-entities", entityIds: ids },
      context,
      operation,
    );
  return { change, model: validatePrepared(m, change, context, operation) };
}
const area = (m: GeometryModel) =>
  Object.values(m.faces).reduce((n, f) => n + tessellateFace(m, f).area, 0);
beforeEach(() => {
  useEditor.getState().replace(emptyProjectV2());
  usePrecision.getState().configure({ path: [], enabled: false });
});
it("erases a rectangle diagonal into one 12m² face with exact inverse and retained boundary IDs", () => {
  const m = insert(base(), [
      [
        [0, 0, 0],
        [4, 3, 0],
      ],
    ]),
    edge = internal(m)[0],
    { change, model: n } = erase(m, [edge]);
  expect(Object.keys(m.faces)).toHaveLength(2);
  expect(Object.keys(n.faces)).toHaveLength(1);
  expect(area(n)).toBeCloseTo(12);
  expect(Object.keys(n.vertices)).toEqual(Object.keys(m.vertices));
  expect(Object.keys(n.edges)).toEqual(
    Object.keys(m.edges).filter((e) => e !== edge),
  );
  expect(change.lineage.filter((l) => l.kind === "face")).toHaveLength(2);
  expect(
    change.lineage
      .filter((l) => l.kind === "face")
      .every((l) => l.reason === "merge"),
  ).toBe(true);
  expect(applyDelta(n, change.inverse, ctx)).toEqual(m);
});
it("merges three adjacent regions atomically", () => {
  const m = insert(base(), [
      [
        [1, 0, 0],
        [1, 3, 0],
      ],
      [
        [3, 0, 0],
        [3, 3, 0],
      ],
    ]),
    n = erase(m, internal(m)).model;
  expect(Object.keys(m.faces)).toHaveLength(3);
  expect(Object.keys(n.faces)).toHaveLength(1);
  expect(area(n)).toBeCloseTo(12);
});
it("preserves the actual opening while erasing a partition beside it", () => {
  const p = topologyProject(),
    old = Object.values(p.geometries)[0],
    context = geometryContext(p, old.id),
    m = insert(
      old,
      [
        [
          [3, 0, 0],
          [3, 3, 0],
        ],
      ],
      context,
    ),
    n = erase(m, internal(m), context).model;
  expect(Object.keys(n.faces)).toHaveLength(1);
  expect(Object.values(n.faces)[0].innerLoopIds).toHaveLength(1);
  expect(area(n)).toBeCloseTo(11);
  expect(Object.keys(n.edges).filter((e) => !internal(m).includes(e))).toEqual(
    Object.keys(m.edges).filter((e) => !internal(m).includes(e)),
  );
});
it("preserves the opening when removing both bridges through an annular region", () => {
  const p = topologyProject(),
    old = Object.values(p.geometries)[0],
    context = geometryContext(p, old.id),
    m = insert(
      old,
      [
        [
          [0, 1.5, 0],
          [1, 1.5, 0],
        ],
        [
          [2, 1.5, 0],
          [4, 1.5, 0],
        ],
      ],
      context,
    ),
    edges = internal(m),
    n = erase(m, edges, context).model;
  expect(edges.length).toBeGreaterThan(0);
  expect(Object.keys(n.faces)).toHaveLength(1);
  expect(Object.values(n.faces)[0].innerLoopIds).toHaveLength(1);
  expect(area(n)).toBeCloseTo(11);
});
it("does not regenerate a separately deleted region", () => {
  let m = insert(base(), [
    [
      [1, 0, 0],
      [1, 3, 0],
    ],
    [
      [3, 0, 0],
      [3, 3, 0],
    ],
  ]);
  const right = Object.values(m.faces).find((f) =>
    tessellateFace(m, f).positions.every((p) => p[0] >= 3),
  )!;
  m = erase(m, [right.id]).model;
  const n = erase(m, internal(m)).model;
  expect(Object.keys(n.faces)).toHaveLength(1);
  expect(area(n)).toBeCloseTo(9);
});
it("outer boundary deletion opens the surface rather than restoring it", () => {
  const m = insert(base(), [
      [
        [0, 0, 0],
        [4, 3, 0],
      ],
    ]),
    outer = Object.keys(m.edges).find((e) => uses(m, e) === 1)!;
  const n = erase(m, [outer]).model;
  expect(Object.keys(n.faces)).toHaveLength(1);
  expect(area(n)).toBeCloseTo(6);
});
it("explicit face deletion is never undone by merging an adjacent edge", () => {
  const m = insert(base(), [
      [
        [0, 0, 0],
        [4, 3, 0],
      ],
    ]),
    n = erase(m, [internal(m)[0], Object.keys(m.faces)[0]]).model;
  expect(Object.keys(n.faces)).toHaveLength(0);
});
it("keeps closed-shell membership and volume after erasing a split cap", () => {
  let m = base();
  const operation = id<"operation">("extrude/" + op++);
  m = validatePrepared(
    m,
    prepareExtrusion(m, Object.keys(m.faces)[0], 3, 1, ctx, operation),
    ctx,
    operation,
  );
  m = insert(m, [
    [
      [0, 0, 3],
      [4, 3, 3],
    ],
  ]);
  const bid = Object.keys(m.bodies)[0],
    n = erase(
      m,
      internal(m).filter((e) => {
        const edge = m.edges[e];
        return (
          m.vertices[edge.start].position[2] === 3 &&
          m.vertices[edge.end].position[2] === 3 &&
          uses(m, e) === 2 &&
          Object.values(m.faces)
            .filter((f) =>
              [f.outerLoopId, ...f.innerLoopIds].some((l) =>
                m.loops[l].coedgeIds.some((c) => m.coedges[c].edgeId === e),
              ),
            )
            .every((f) => Math.abs(f.plane.normal[2]) > 0.99)
        );
      }),
    ).model;
  expect(Object.keys(n.faces)).toHaveLength(6);
  expect(Object.keys(n.bodies)).toEqual([bid]);
  expect(classifyBody(n, bid)).toBe("closed-shell");
  expect(bodyVolume(n, bid)).toBeCloseTo(36);
  expect(n.shells).not.toEqual({});
});
it("refuses material conflicts without modifying the input", () => {
  const m = insert(base(), [
    [
      [0, 0, 0],
      [4, 3, 0],
    ],
  ]);
  Object.values(m.faces)[1].frontMaterialId = id("material/other");
  const before = structuredClone(m);
  expect(() => erase(m, internal(m))).toThrow(/материалы/);
  expect(m).toEqual(before);
});
it("refuses partial deletion around an unselected internal divider", () => {
  const m = insert(base(), [
      [
        [2, 0, 0],
        [2, 3, 0],
      ],
      [
        [0, 1.5, 0],
        [4, 1.5, 0],
      ],
    ]),
    edges = internal(m);
  expect(edges).toHaveLength(4);
  expect(() => erase(m, edges.slice(0, 3))).toThrow(/внутренние/);
});
it("computes coplanarity and area under a rotated nonuniform occurrence", () => {
  const m = insert(base(), [
      [
        [0, 0, 0],
        [4, 3, 0],
      ],
    ]),
    context = {
      ...ctx,
      worldTransform: placementMatrix({
        translation: [100, 20, -50],
        rotation: [0, Math.sin(0.3), 0, Math.cos(0.3)],
        scale: [2, 3, 0.5],
      }),
    };
  const n = erase(m, internal(m), context).model;
  expect(
    Object.values(n.faces).reduce(
      (a, f) =>
        a + tessellationArea(tessellateFace(n, f), context.worldTransform),
      0,
    ),
  ).toBeCloseTo(72);
});
it("uses document history, migratable references and exact file roundtrip", async () => {
  const p = emptyProjectV2(),
    m = insert(base(), [
      [
        [0, 0, 0],
        [4, 3, 0],
      ],
    ]);
  p.materials["material/main"] = {
    id: "material/main",
    color: "#abcdef",
    roughness: 0.5,
    metalness: 0,
  };
  p.geometries[m.id] = m;
  p.definitions[p.rootDefinitionId].geometryId = m.id;
  const oldFace = Object.keys(m.faces)[0];
  p.references.test = {
    id: "test",
    target: {
      definitionId: p.rootDefinitionId,
      geometryId: m.id,
      kind: "face",
      entityId: oldFace,
      occurrencePath: [],
    },
  };
  validateProject(p);
  useEditor.getState().replace(p);
  const edge = internal(m)[0];
  useEditor.getState().selectEntity({
    definitionId: p.rootDefinitionId,
    geometryId: m.id,
    kind: "edge",
    entityId: edge,
    occurrencePath: [],
  });
  expect((await useEditor.getState().deleteSelection()).status).toBe("applied");
  const after = useEditor.getState().project as ProjectV2;
  validateProject(after);
  expect(serializeProject(parseProject(serializeProject(after)))).toBe(
    serializeProject(after),
  );
  expect(
    after.provenance
      .filter((l) => l.kind === "face")
      .every((l) => l.reason === "merge"),
  ).toBe(true);
  useEditor.getState().undo();
  expect(useEditor.getState().project).toEqual(p);
  useEditor.getState().redo();
  expect(useEditor.getState().project).toEqual(after);
});

it("retains the existing policy rejecting mirrored placements without input changes", () => {
  const m = insert(base(), [
      [
        [0, 0, 0],
        [4, 3, 0],
      ],
    ]),
    before = structuredClone(m),
    matrix = placementMatrix({
      translation: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: [2, 3, 0.5],
    });
  for (let i = 0; i < 3; i++) matrix[i] *= -1;
  expect(() =>
    erase(m, internal(m), { ...ctx, worldTransform: matrix }),
  ).toThrow(/mirrored/);
  expect(m).toEqual(before);
});
it("rejects conflicting paint atomically through editor Delete without changing dirty/history", async () => {
  const p = emptyProjectV2(),
    m = insert(base(), [
      [
        [0, 0, 0],
        [4, 3, 0],
      ],
    ]);
  for (const key of ["material/main", "material/other"])
    p.materials[key] = {
      id: key,
      color: key.endsWith("main") ? "#123456" : "#abcdef",
      roughness: 0.5,
      metalness: 0,
    };
  Object.values(m.faces)[1].frontMaterialId = id("material/other");
  p.geometries[m.id] = m;
  p.definitions[p.rootDefinitionId].geometryId = m.id;
  useEditor.getState().replace(p);
  useEditor.getState().selectEntity({
    definitionId: p.rootDefinitionId,
    geometryId: m.id,
    entityId: internal(m)[0],
    kind: "edge",
    occurrencePath: [],
  });
  const before = useEditor.getState(),
    result = await useEditor.getState().deleteSelection();
  expect(result.status).toBe("rejected");
  expect(useEditor.getState().project).toBe(before.project);
  expect(useEditor.getState().savedSignature).toBe(before.savedSignature);
  expect(useEditor.getState().revision).toBe(before.revision);
  expect(useEditor.getState().canUndo).toBe(false);
  expect(useEditor.getState().canRedo).toBe(false);
});

it("merges oppositely parameterised faces while preserving their physical front/back paint", () => {
  const m = insert(base(), [
      [
        [0, 0, 0],
        [4, 3, 0],
      ],
    ]),
    faces = Object.values(m.faces);
  for (const f of faces) f.backMaterialId = id("material/other");
  const f = faces[1];
  [f.frontMaterialId, f.backMaterialId] = [f.backMaterialId, f.frontMaterialId];
  f.plane.v = f.plane.v.map((n) => -n) as Vec3;
  f.plane.normal = f.plane.normal.map((n) => -n) as Vec3;
  for (const lid of [f.outerLoopId, ...f.innerLoopIds]) {
    m.loops[lid].coedgeIds.reverse();
    for (const cid of m.loops[lid].coedgeIds)
      m.coedges[cid].direction = m.coedges[cid].direction === 1 ? -1 : 1;
  }
  const n = erase(m, internal(m)).model;
  expect(Object.keys(n.faces)).toHaveLength(1);
  expect(area(n)).toBeCloseTo(12);
  expect(Object.values(n.faces)[0].frontMaterialId).toBe("material/main");
  expect(Object.values(n.faces)[0].backMaterialId).toBe("material/other");
});
it("leaves another group byte-identical when merging only the selected group's divider", async () => {
  let m = insert(base(), [
    [
      [0, 0, 0],
      [4, 3, 0],
    ],
  ]);
  const p = emptyProjectV2();
  p.materials["material/main"] = {
    id: "material/main",
    color: "#abcdef",
    roughness: 0.5,
    metalness: 0,
  };
  p.geometries[m.id] = m;
  p.definitions[p.rootDefinitionId].geometryId = m.id;
  useEditor.getState().replace(p);
  useEditor.getState().groupScene();
  const grouped = useEditor.getState().project as ProjectV2,
    nid = Object.keys(grouped.nodes)[0];
  expect(useEditor.getState().copyInstance(nid).status).toBe("applied");
  const copy = useEditor.getState().project as ProjectV2;
  const otherId = Object.keys(copy.nodes).find((key) => key !== nid)!;
  expect(useEditor.getState().makeUnique(otherId).status).toBe("applied");
  const before = useEditor.getState().project as ProjectV2;
  m = before.geometries["geometry/main"];
  const other = before.nodes[otherId];
  if (other.kind === "legacy-primitive") throw Error();
  const otherGid = before.definitions[other.definitionId].geometryId!;
  usePrecision.getState().configure({ path: [nid] });
  useEditor
    .getState()
    .selectEntity({
      definitionId: m.ownerDefinitionId,
      geometryId: m.id,
      entityId: internal(m)[0],
      kind: "edge",
      occurrencePath: [nid],
    });
  expect((await useEditor.getState().deleteSelection()).status).toBe("applied");
  const after = useEditor.getState().project as ProjectV2;
  expect(Object.keys(after.geometries[m.id].faces)).toHaveLength(1);
  expect(after.geometries[otherGid]).toEqual(before.geometries[otherGid]);
  expect(after.nodes).toEqual(before.nodes);
});
