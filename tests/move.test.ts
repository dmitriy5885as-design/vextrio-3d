import { beforeEach, it, expect } from "vitest";
import {
  useEditor,
  usePrecision,
  useMove,
  awaitGeometryCommits,
} from "@forma/editor";
import {
  emptyProjectV2,
  geometryContext,
  parseProject,
  serializeProject,
  occurrenceMatrix,
  type ProjectV2,
} from "@forma/document";
import {
  prepareEntityTranslation,
  prepareVertexMove,
  validatePrepared as checkPrepared,
  entityTables,
  tessellateFace,
  bodyVolume,
  transformAffine,
  GeometrySession,
  createLocalGeometryBackend,
  id,
  type GeometryModel,
  type PreparedGeometryChange,
  type ValidationContext,
  type Vec3,
} from "@forma/geometry";
import { topologyProject, componentProject } from "./fixtures/v2-project";
const validatePrepared = (
  m: GeometryModel,
  c: PreparedGeometryChange,
  ctx: ValidationContext,
) => checkPrepared(m, c, ctx, id("validation"));
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
it("moves a face in world space, preserves all IDs/materials and updates its plane", async () => {
  await useEditor.getState().drawSegments([], rect);
  const { g, f, context } = state(),
    change = prepareEntityTranslation(
      g,
      [{ kind: "face", id: f.id }],
      [0, 2, 0],
      false,
      context,
      id("move"),
    ),
    after = validatePrepared(g, change, context);
  for (const table of entityTables)
    expect(Object.keys(after[table])).toEqual(Object.keys(g[table]));
  for (const v of Object.values(after.vertices)) expect(v.position[1]).toBe(2);
  expect(after.faces[f.id].plane.origin[1]).toBe(2);
  expect(after.faces[f.id].frontMaterialId).toBe(f.frontMaterialId);
  expect(tessellateFace(after, after.faces[f.id]).area).toBeCloseTo(12, 9);
});
it("moves a top face and its adjacent sides into a taller closed body", async () => {
  await useEditor.getState().drawSegments([], rect);
  let { ref, f } = state();
  await useEditor.getState().editGeometry(ref, {
    kind: "extrude-face",
    faceId: f.id,
    distance: 3,
    side: 1,
  });
  const { g, context } = state(),
    top = Object.values(g.faces).find(
      (f) =>
        Math.abs(f.plane.origin[1] - 3) < 1e-7 &&
        Math.abs(f.plane.normal[1]) > 0.9,
    )!;
  const after = validatePrepared(
    g,
    prepareEntityTranslation(
      g,
      [{ kind: "face", id: top.id }],
      [0, 1, 0],
      false,
      context,
      id("taller"),
    ),
    context,
  );
  expect(bodyVolume(after, Object.keys(after.bodies)[0])).toBeCloseTo(48, 8);
});
it("raises a real ridge shared by two roof faces into a 42 cubic metre gabled model", async () => {
  await useEditor.getState().drawSegments([], rect);
  let { ref, f } = state();
  await useEditor.getState().editGeometry(ref, {
    kind: "extrude-face",
    faceId: f.id,
    distance: 3,
    side: 1,
  });
  await useEditor.getState().drawSegments(
    [],
    [
      [
        [2, 3, 0],
        [2, 3, 3],
      ],
    ],
  );
  const { g, context } = state(),
    ridge = Object.values(g.edges).find((e) =>
      [e.start, e.end].every(
        (v) =>
          g.vertices[v].position[0] === 2 && g.vertices[v].position[1] === 3,
      ),
    )!;
  expect(ridge).toBeDefined();
  const after = validatePrepared(
    g,
    prepareEntityTranslation(
      g,
      [{ kind: "edge", id: ridge.id }],
      [0, 1, 0],
      false,
      context,
      id("roof"),
    ),
    context,
  );
  expect(bodyVolume(after, Object.keys(after.bodies)[0])).toBeCloseTo(42, 7);
  expect(Object.keys(after.edges)).toEqual(Object.keys(g.edges));
});
it("rejects an unsupported nonplanar face with a hole atomically and preserves redo history", async () => {
  useEditor.getState().replace(topologyProject());
  const { g, ref } = state();
  await useEditor.getState().editGeometry(ref, {
    kind: "translate-entities",
    entities: [{ kind: "face", id: ref.entityId }],
    delta: [0, 0, 1],
    copy: false,
  });
  useEditor.getState().undo();
  const before = useEditor.getState();
  const result = await before.editGeometry(
    { ...ref, kind: "vertex", entityId: Object.keys(g.vertices)[0] },
    {
      kind: "translate-entities",
      entities: [{ kind: "vertex", id: Object.keys(g.vertices)[0] }],
      delta: [0, 0, 1],
      copy: false,
    },
  );
  expect(result.status).toBe("rejected");
  expect(useEditor.getState().project).toBe(before.project);
  expect(useEditor.getState().canRedo).toBe(true);
  expect(useEditor.getState().revision).toBe(before.revision);
});
it("moves a vertex within its face plane and refits area without replacing IDs", async () => {
  await useEditor.getState().drawSegments([], rect);
  const { g, context } = state(),
    v = Object.values(g.vertices).find(
      (v) => v.position[0] === 4 && v.position[2] === 3,
    )!;
  const after = validatePrepared(
    g,
    prepareVertexMove(g, [{ vertexId: v.id, position: [5, 0, 3] }], context),
    context,
  );
  expect(tessellateFace(after, Object.values(after.faces)[0]).area).toBeCloseTo(
    13.5,
    8,
  );
});
it("copies a face and hole with new IDs, material and independent boundaries", () => {
  const p = topologyProject(),
    g = Object.values(p.geometries)[0],
    f = Object.values(g.faces)[0],
    context = geometryContext(p, g.id, true, []),
    after = validatePrepared(
      g,
      prepareEntityTranslation(
        g,
        [{ kind: "face", id: f.id }],
        [0, 0, 2],
        true,
        context,
        id("copy"),
      ),
      context,
    );
  const copy = Object.values(after.faces).find((x) => x.id !== f.id)!;
  expect(copy.innerLoopIds).toHaveLength(1);
  expect(copy.frontMaterialId).toBe(f.frontMaterialId);
  expect(tessellateFace(after, copy).area).toBeCloseTo(
    tessellateFace(g, f).area,
    8,
  );
  for (const t of entityTables)
    for (const [id, v] of Object.entries(g[t])) expect(after[t][id]).toEqual(v);
});
it("rejects copy onto the source, collisions and degenerate edges", async () => {
  await useEditor.getState().drawSegments([], rect);
  const { g, f, context } = state();
  expect(() =>
    prepareEntityTranslation(
      g,
      [{ kind: "face", id: f.id }],
      [0, 0, 0],
      true,
      context,
      id("zero"),
    ),
  ).toThrow();
  expect(() =>
    prepareEntityTranslation(
      g,
      [{ kind: "face", id: f.id }],
      [1, 0, 0],
      true,
      context,
      id("overlap"),
    ),
  ).toThrow();
  const edge = Object.values(g.edges)[0];
  expect(() =>
    prepareVertexMove(
      g,
      [{ vertexId: edge.start, position: g.vertices[edge.end].position }],
      context,
    ),
  ).toThrow();
});
it.each([NaN, Infinity, 1e10])(
  "rejects nonfinite/out-of-range displacement %s",
  async (n) => {
    await useEditor.getState().drawSegments([], rect);
    const { g, f, context } = state();
    expect(() =>
      prepareEntityTranslation(
        g,
        [{ kind: "face", id: f.id }],
        [n, 0, 0],
        false,
        context,
        id("invalid"),
      ),
    ).toThrow();
  },
);
it("deduplicates mixed vertex/edge/face selection and treats zero move as no-op", async () => {
  await useEditor.getState().drawSegments([], rect);
  const { g, f, context } = state(),
    v = Object.values(g.vertices)[0],
    e = Object.values(g.edges)[0];
  const after = validatePrepared(
    g,
    prepareEntityTranslation(
      g,
      [
        { kind: "face", id: f.id },
        { kind: "edge", id: e.id },
        { kind: "vertex", id: v.id },
      ],
      [0, 1, 0],
      false,
      context,
      id("mixed"),
    ),
    context,
  );
  expect(after.vertices[v.id].position[1]).toBe(1);
  const zero = prepareEntityTranslation(
    g,
    [{ kind: "face", id: f.id }],
    [0, 0, 0],
    false,
    context,
    id("noop"),
  );
  expect(entityTables.every((t) => zero.forward[t].length === 0)).toBe(true);
});
it("roundtrips moves and copies with exact Undo/Redo and topology IDs", async () => {
  await useEditor.getState().drawSegments([], rect);
  const { p, ref } = state();
  for (const copy of [false, true]) {
    const r = await useEditor.getState().editGeometry(ref, {
      kind: "translate-entities",
      entities: [{ kind: "face", id: ref.entityId }],
      delta: [0, 2, 0],
      copy,
    });
    expect(r.status).toBe("applied");
  }
  const after = useEditor.getState().project;
  expect(
    (parseProject(serializeProject(after)) as ProjectV2).geometries,
  ).toEqual((after as ProjectV2).geometries);
  useEditor.getState().undo();
  useEditor.getState().undo();
  expect(useEditor.getState().project).toEqual(p);
  useEditor.getState().redo();
  useEditor.getState().redo();
  expect(useEditor.getState().project).toEqual(after);
});
it("bounds collision work and rejects stale/cancelled session replies", async () => {
  await useEditor.getState().drawSegments([], rect);
  const { g, context, f } = state(),
    local = createLocalGeometryBackend(context),
    pending: {
      request: import("@forma/geometry").GeometryRequest;
      resolve: (r: import("@forma/geometry").GeometryResponse) => void;
    }[] = [],
    session = new GeometrySession(
      g,
      context,
      {
        propose: (request) =>
          new Promise((resolve) => pending.push({ request, resolve })),
      },
      id("delayed-move"),
    );
  const intent = {
      kind: "translate-entities" as const,
      entities: [{ kind: "face" as const, id: f.id }],
      delta: [0, 1, 0] as Vec3,
      copy: false,
    },
    a = session.execute(intent),
    b = session.execute(intent);
  pending[1].resolve(await local.propose(pending[1].request));
  expect((await b).status).toBe("applied");
  pending[0].resolve(await local.propose(pending[0].request));
  expect((await a).status).toBe("stale");
  const c = session.prepare(intent);
  session.cancelAll();
  pending[2].resolve(await local.propose(pending[2].request));
  expect((await c).status).toBe("cancelled");
});
it("waits for confirmed pointer moves at the save barrier but ignores previews", async () => {
  await useEditor.getState().drawSegments([], rect);
  const { ref } = state();
  useMove.getState().begin({
    refs: [ref],
    anchor: [0, 0, 0],
    target: [0, 1, 0],
    revision: useEditor.getState().revision,
  });
  await awaitGeometryCommits();
  useMove.getState().confirm();
  let saved = false;
  const done = awaitGeometryCommits().then(() => (saved = true));
  await Promise.resolve();
  expect(saved).toBe(false);
  useMove.getState().cancel();
  await done;
  expect(saved).toBe(true);
});

it("moves physical world distances inside a rotated nonuniform group without changing its neighbour", async () => {
  const doc = componentProject(),
    node = doc.nodes["instance/group"];
  if (node.kind === "legacy-primitive") throw Error("fixture");
  node.transform.scale = [2, 3, 4];
  node.transform.rotation = [0, 0, Math.sin(0.2), Math.cos(0.2)];
  useEditor.getState().replace(doc);
  await useEditor.getState().drawSegments([node.id], rect);
  const p = useEditor.getState().project as ProjectV2,
    g = p.geometries[p.definitions[node.definitionId].geometryId!],
    f = Object.values(g.faces)[0],
    matrix = occurrenceMatrix(p, [node.id]),
    ref = {
      definitionId: g.ownerDefinitionId,
      geometryId: g.id,
      kind: "face" as const,
      entityId: f.id,
      occurrencePath: [node.id],
    },
    delta: Vec3 = [0.2, 0.3, 0.4];
  expect(
    (
      await useEditor.getState().editGeometry(ref, {
        kind: "translate-entities",
        entities: [{ kind: "face", id: f.id }],
        delta,
        copy: false,
      })
    ).status,
  ).toBe("applied");
  const after = useEditor.getState().project as ProjectV2;
  expect(after.nodes).toEqual(p.nodes);
  expect(after.geometries["native/geometry"]).toEqual(
    p.geometries["native/geometry"],
  );
  for (const v of Object.values(g.vertices)) {
    const a = transformAffine(v.position, matrix),
      b = transformAffine(
        after.geometries[g.id].vertices[v.id].position,
        matrix,
      );
    for (let i = 0; i < 3; i++) expect(b[i] - a[i]).toBeCloseTo(delta[i], 8);
  }
});
it("a locked sibling instance prevents both moving and copying shared geometry", async () => {
  const doc = componentProject();
  doc.nodes["instance/one"].locked = true;
  useEditor.getState().replace(doc);
  const before = useEditor.getState(),
    g = doc.geometries["native/geometry"],
    f = Object.values(g.faces)[0],
    ref = {
      definitionId: g.ownerDefinitionId,
      geometryId: g.id,
      kind: "face" as const,
      entityId: f.id,
      occurrencePath: ["instance/two"],
    };
  for (const copy of [false, true])
    expect(
      (
        await useEditor.getState().editGeometry(ref, {
          kind: "translate-entities",
          entities: [{ kind: "face", id: f.id }],
          delta: [0, 0, 1],
          copy,
        })
      ).status,
    ).toBe("rejected");
  expect(useEditor.getState().project).toBe(before.project);
  expect(useEditor.getState().revision).toBe(before.revision);
});
it("rejects duplicate vertex entries even when the first entry is unchanged", async () => {
  await useEditor.getState().drawSegments([], rect);
  const { g, context } = state(),
    v = Object.values(g.vertices)[0];
  expect(() =>
    prepareVertexMove(
      g,
      [
        { vertexId: v.id, position: v.position },
        { vertexId: v.id, position: [1, 0, 0] },
      ],
      context,
    ),
  ).toThrow();
});

it("rejects a free wire piercing a face interior but allows the same wire through a hole", () => {
  for (const hole of [false, true]) {
    const p = topologyProject(hole),
      g = Object.values(p.geometries)[0],
      context = geometryContext(p, g.id, true, []),
      op = id<"session">("wire"),
      session = new GeometrySession(
        g,
        context,
        createLocalGeometryBackend(context),
        op,
      );
    // A separate wire lies wholly in front of the XY face initially.
    const v1 = id<"vertex">("wire/a"),
      v2 = id<"vertex">("wire/b"),
      e = id<"edge">("wire/e"),
      b = id<"body">("wire/body");
    g.vertices[v1] = { id: v1, position: [1.5, 1.5, 2] };
    g.vertices[v2] = { id: v2, position: [1.5, 1.5, 4] };
    g.edges[e] = { id: e, start: v1, end: v2, curve: { kind: "line" } };
    g.bodies[b] = {
      id: b,
      vertexIds: [v1, v2],
      edgeIds: [e],
      faceIds: [],
      shellIds: [],
    };
    const run = () =>
      prepareEntityTranslation(
        g,
        [{ kind: "edge", id: e }],
        [0, 0, -3],
        false,
        context,
        id("pierce"),
      );
    if (hole) expect(run).not.toThrow();
    else expect(run).toThrow(/пересекает грань/);
    expect(session.snapshot.vertices[v1]).toBeUndefined();
  }
});
