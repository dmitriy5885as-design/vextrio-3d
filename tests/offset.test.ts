import { beforeEach, expect, it } from "vitest";
import {
  useEditor,
  isDirty,
  usePrecision,
  useOffset,
  awaitGeometryCommits,
} from "@forma/editor";
import {
  emptyProjectV2,
  geometryContext,
  serializeProject,
  parseProject,
  occurrenceMatrix,
  type ProjectV2,
} from "@forma/document";
import {
  faceOffsetProfile,
  offsetReference,
  tessellateFace,
  GeometrySession,
  createLocalGeometryBackend,
  id,
  bodyVolume,
  classifyBody,
  arcProfile,
  transformAffine,
  type Vec3,
  type GeometryModel,
} from "@forma/geometry";
import { workPlane } from "@forma/snapping";
import { componentProject } from "./fixtures/v2-project";
const rect: (w: number, h: number) => [Vec3, Vec3][] = (w, h) => [
  [
    [0, 0, 0],
    [w, 0, 0],
  ],
  [
    [w, 0, 0],
    [w, h, 0],
  ],
  [
    [w, h, 0],
    [0, h, 0],
  ],
  [
    [0, h, 0],
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
    ref: {
      definitionId: g.ownerDefinitionId,
      geometryId: g.id,
      kind: "face" as const,
      entityId: f.id,
      occurrencePath: [],
    },
    context: geometryContext(p, g.id, true, []),
  };
};
const areas = (g: GeometryModel) =>
  Object.values(g.faces)
    .map((f) => tessellateFace(g, f).area)
    .sort((a, b) => a - b);
beforeEach(() => {
  useEditor.getState().setTool("select");
  useEditor.getState().replace(emptyProjectV2());
  usePrecision
    .getState()
    .configure({ path: [], planeName: "XY", system: "world" });
});
it("insets a 4 by 3 face by 200 mm into real wall and room faces, then extrudes the wall", async () => {
  await useEditor.getState().drawSegments([], rect(4, 3));
  const { p, g, f, ref, context } = state();
  const profile = faceOffsetProfile(g, f.id, 0.2, context);
  expect(profile.paths).toHaveLength(1);
  expect(profile.area).toBeCloseTo(9.36, 7);
  expect(profile.quantization).toBeLessThan(1e-8);
  expect(
    (
      await useEditor
        .getState()
        .editGeometry(ref, { kind: "offset-face", faceId: f.id, distance: 0.2 })
    ).status,
  ).toBe("applied");
  const after = useEditor.getState().project as ProjectV2,
    m = after.geometries[g.id];
  expect(areas(m)).toEqual(
    expect.arrayContaining([expect.closeTo(2.64, 7), expect.closeTo(9.36, 7)]),
  );
  expect(Object.keys(m.edges)).toHaveLength(8);
  expect(Object.keys(m.vertices)).toHaveLength(8);
  expect(Object.keys(m.faces)).toHaveLength(2);
  for (const [key, v] of Object.entries(g.vertices))
    expect(m.vertices[key]).toEqual(v);
  useEditor.getState().undo();
  expect(useEditor.getState().project).toEqual(p);
  useEditor.getState().redo();
  expect(useEditor.getState().project).toEqual(after);
  const ring = Object.values(m.faces).find((x) => x.innerLoopIds.length === 1)!;
  expect(ring).toBeDefined();
  const center = Object.values(m.faces).find((x) => x.id !== ring.id)!;
  expect(
    (
      await useEditor
        .getState()
        .editGeometry(
          { ...ref, entityId: center.id },
          { kind: "delete-entities", entityIds: [center.id] },
        )
    ).status,
  ).toBe("applied");
  expect(
    (
      await useEditor
        .getState()
        .editGeometry(
          { ...ref, entityId: ring.id },
          { kind: "extrude-face", faceId: ring.id, distance: 3, side: 1 },
        )
    ).status,
  ).toBe("applied");
  const solid = useEditor.getState().project as ProjectV2,
    mg = solid.geometries[g.id];
  expect(
    Object.values(mg.bodies).some(
      (b) => classifyBody(mg, b.id) === "closed-shell",
    ),
  ).toBe(true);
  const volumes = Object.values(mg.bodies)
    .map((b) => bodyVolume(mg, b.id))
    .filter((x) => x !== null);
  expect(volumes.some((v) => Math.abs(v! - 7.92) < 1e-6)).toBe(true);
  expect(parseProject(serializeProject(solid))).toEqual(
    JSON.parse(JSON.stringify(solid)),
  );
});
it("outsets a rectangle without replacing its original edges", async () => {
  await useEditor.getState().drawSegments([], rect(4, 3));
  const { g, f, ref, context } = state();
  expect(faceOffsetProfile(g, f.id, -0.2, context).area).toBeCloseTo(14.96, 7);
  expect(
    (
      await useEditor.getState().editGeometry(ref, {
        kind: "offset-face",
        faceId: f.id,
        distance: -0.2,
      })
    ).status,
  ).toBe("applied");
  const m = (useEditor.getState().project as ProjectV2).geometries[g.id];
  expect(areas(m).reduce((a, b) => a + b, 0)).toBeCloseTo(14.96, 7);
  for (const [key, e] of Object.entries(g.edges))
    expect(m.edges[key]).toEqual(e);
});
it("rejects zero, nonfinite, collapsed and missing-face offsets atomically", async () => {
  await useEditor.getState().drawSegments([], rect(4, 3));
  const { g, f, ref, p } = state();
  useEditor.getState().markSaved(JSON.stringify(p));
  const before = useEditor.getState();
  for (const distance of [0, 1e-10, NaN, Infinity, 1.5, 2, 10]) {
    const result = await useEditor
      .getState()
      .editGeometry(ref, { kind: "offset-face", faceId: f.id, distance });
    expect(result.status).toBe("rejected");
    expect(useEditor.getState().project).toBe(before.project);
    expect(useEditor.getState().revision).toBe(before.revision);
    expect(isDirty()).toBe(false);
    expect(useEditor.getState().canUndo).toBe(before.canUndo);
  }
  expect(() =>
    faceOffsetProfile(g, "missing", 0.2, geometryContext(p, g.id)),
  ).toThrow();
});
it("resolves a concave L outline as a valid inset", async () => {
  const pts: Vec3[] = [
    [0, 0, 0],
    [4, 0, 0],
    [4, 1, 0],
    [1, 1, 0],
    [1, 4, 0],
    [0, 4, 0],
  ];
  await useEditor.getState().drawSegments(
    [],
    pts.map((p, i) => [p, pts[(i + 1) % pts.length]]),
  );
  const { g, f, context, ref } = state();
  const profile = faceOffsetProfile(g, f.id, 0.2, context);
  expect(profile.area).toBeCloseTo(3.96, 7);
  expect(
    (
      await useEditor
        .getState()
        .editGeometry(ref, { kind: "offset-face", faceId: f.id, distance: 0.2 })
    ).status,
  ).toBe("applied");
  expect(
    areas((useEditor.getState().project as ProjectV2).geometries[g.id]).reduce(
      (a, b) => a + b,
      0,
    ),
  ).toBeCloseTo(7, 7);
});
it("offsets both outer and hole boundaries in the correct physical direction", async () => {
  await useEditor.getState().drawSegments([], rect(6, 6));
  await useEditor.getState().drawSegments(
    [],
    rect(2, 2).map(([a, b]) => [
      a.map((x, i) => (i < 2 ? x + 2 : x)) as Vec3,
      b.map((x, i) => (i < 2 ? x + 2 : x)) as Vec3,
    ]),
  );
  const { g, context, ref } = state(),
    f = Object.values(g.faces).find((x) => x.innerLoopIds.length === 1)!;
  expect(faceOffsetProfile(g, f.id, 0.25, context).area).toBeCloseTo(24, 7);
  expect(faceOffsetProfile(g, f.id, -0.25, context).area).toBeCloseTo(40, 7);
  expect(
    (
      await useEditor
        .getState()
        .editGeometry(
          { ...ref, entityId: f.id },
          { kind: "offset-face", faceId: f.id, distance: 0.25 },
        )
    ).status,
  ).toBe("applied");
  const after = (useEditor.getState().project as ProjectV2).geometries[g.id];
  expect(areas(after).reduce((a, b) => a + b, 0)).toBeCloseTo(36, 7);
});
it("preview and cancellation never write the document", async () => {
  await useEditor.getState().drawSegments([], rect(4, 3));
  const { g, f, context, p } = state(),
    s = new GeometrySession(
      g,
      context,
      createLocalGeometryBackend(context),
      id("offset-test"),
    );
  expect(
    (await s.prepare({ kind: "offset-face", faceId: f.id, distance: 0.2 }))
      .status,
  ).toBe("preview");
  expect(useEditor.getState().project).toBe(p);
  expect(s.snapshot).toEqual(g);
});

it("splits an eroded narrow-neck face into two valid offset loops", async () => {
  const pts: Vec3[] = [
    [0, 0, 0],
    [2, 0, 0],
    [2, 0.8, 0],
    [4, 0.8, 0],
    [4, 0, 0],
    [6, 0, 0],
    [6, 3, 0],
    [4, 3, 0],
    [4, 2.2, 0],
    [2, 2.2, 0],
    [2, 3, 0],
    [0, 3, 0],
  ];
  await useEditor.getState().drawSegments(
    [],
    pts.map((p, i) => [p, pts[(i + 1) % pts.length]]),
  );
  const { g, f, context, ref } = state(),
    profile = faceOffsetProfile(g, f.id, 0.8, context);
  expect(profile.paths).toHaveLength(2);
  expect(profile.area).toBeCloseTo(1.12, 7);
  expect(
    (
      await useEditor
        .getState()
        .editGeometry(ref, { kind: "offset-face", faceId: f.id, distance: 0.8 })
    ).status,
  ).toBe("applied");
  const result = (useEditor.getState().project as ProjectV2).geometries[g.id];
  expect(Object.keys(result.faces)).toHaveLength(3);
  expect(areas(result).reduce((a, b) => a + b, 0)).toBeCloseTo(14.8, 7);
});
it("keeps a deleted hole empty while adding offset contours", async () => {
  await useEditor.getState().drawSegments([], rect(6, 6));
  await useEditor.getState().drawSegments(
    [],
    rect(2, 2).map(([a, b]) => [
      a.map((x, i) => (i < 2 ? x + 2 : x)) as Vec3,
      b.map((x, i) => (i < 2 ? x + 2 : x)) as Vec3,
    ]),
  );
  let { g, ref } = state();
  const center = Object.values(g.faces).find((f) => !f.innerLoopIds.length)!;
  await useEditor
    .getState()
    .editGeometry(
      { ...ref, entityId: center.id },
      { kind: "delete-entities", entityIds: [center.id] },
    );
  ({ g, ref } = state());
  const f = Object.values(g.faces)[0],
    hole = g.loops[f.innerLoopIds[0]];
  expect(
    (
      await useEditor
        .getState()
        .editGeometry(
          { ...ref, entityId: f.id },
          { kind: "offset-face", faceId: f.id, distance: 0.25 },
        )
    ).status,
  ).toBe("applied");
  const result = (useEditor.getState().project as ProjectV2).geometries[g.id];
  expect(areas(result).reduce((a, b) => a + b, 0)).toBeCloseTo(32, 7);
  expect(result.loops[hole.id]).toEqual(hole);
});
it("keeps offsets physically accurate inside a nonuniformly scaled rotated group", async () => {
  const p = componentProject(),
    node = p.nodes["instance/group"];
  if (node.kind === "legacy-primitive") throw Error("fixture");
  node.transform.scale = [2, 3, 4];
  node.transform.rotation = [0, 0, Math.sin(0.2), Math.cos(0.2)];
  useEditor.getState().replace(p);
  await useEditor.getState().drawSegments([node.id], rect(4, 3));
  const doc = useEditor.getState().project as ProjectV2,
    gid = doc.definitions[node.definitionId].geometryId!,
    g = doc.geometries[gid],
    f = Object.values(g.faces)[0],
    context = geometryContext(doc, gid, true, [node.id]),
    ref = {
      definitionId: node.definitionId,
      geometryId: gid,
      kind: "face" as const,
      entityId: f.id,
      occurrencePath: [node.id],
    };
  expect(faceOffsetProfile(g, f.id, 0.2, context).area).toBeCloseTo(9.36, 7);
  expect(
    (
      await useEditor
        .getState()
        .editGeometry(ref, { kind: "offset-face", faceId: f.id, distance: 0.2 })
    ).status,
  ).toBe("applied");
  const after = useEditor.getState().project as ProjectV2;
  expect(after.geometries["native/geometry"]).toEqual(
    doc.geometries["native/geometry"],
  );
  expect(after.nodes).toEqual(doc.nodes);
  const matrix = occurrenceMatrix(after, [node.id]),
    points = Object.values(after.geometries[gid].vertices)
      .filter((v) => !g.vertices[v.id])
      .map((v) => transformAffine(v.position, matrix));
  expect(Math.min(...points.map((p) => p[0]))).toBeCloseTo(0.2, 7);
  expect(Math.max(...points.map((p) => p[0]))).toBeCloseTo(3.8, 7);
  expect(Math.min(...points.map((p) => p[1]))).toBeCloseTo(0.2, 7);
  expect(Math.max(...points.map((p) => p[1]))).toBeCloseTo(2.8, 7);
});
it("offsets an arc profile as parallel real edges rather than scaling its bounding box", async () => {
  const arc = arcProfile([0, 0, 0], [2, 0, 0], [1, 1, 0], workPlane("XY"));
  await useEditor.getState().drawSegments(
    [],
    [
      ...arc.segments,
      [
        [2, 0, 0],
        [0, 0, 0],
      ],
    ],
  );
  const { g, f, context } = state(),
    profile = faceOffsetProfile(g, f.id, 0.1, context);
  expect(profile.area).toBeGreaterThan(1);
  expect(profile.area).toBeLessThan(1.55291428);
  const old = [
    ...arc.segments,
    [
      [2, 0, 0],
      [0, 0, 0],
    ],
  ] as [Vec3, Vec3][];
  for (const path of profile.paths)
    for (let i = 0; i < path.length; i++) {
      const a = path[i],
        b = path[(i + 1) % path.length],
        d = [b[0] - a[0], b[1] - a[1]];
      expect(
        old.some(([u, v]) => {
          const e = [v[0] - u[0], v[1] - u[1]],
            n = Math.hypot(...e),
            parallel =
              Math.abs(d[0] * e[1] - d[1] * e[0]) / (Math.hypot(...d) * n);
          return (
            parallel < 1e-7 &&
            Math.abs(
              Math.abs((a[0] - u[0]) * e[1] - (a[1] - u[1]) * e[0]) / n - 0.1,
            ) < 1e-7
          );
        }),
      ).toBe(true);
    }
});
it("uses a translated integer grid without losing a small offset at large coordinates", async () => {
  const segments = rect(4, 3).map(
    ([a, b]) =>
      [
        a.map((x, i) => (i < 2 ? x + 1e8 : x)) as Vec3,
        b.map((x, i) => (i < 2 ? x + 1e8 : x)) as Vec3,
      ] as [Vec3, Vec3],
  );
  await useEditor.getState().drawSegments([], segments);
  const { g, f, context } = state(),
    profile = faceOffsetProfile(g, f.id, 0.2, context);
  expect(profile.area).toBeCloseTo(9.36, 6);
  expect(Math.min(...profile.paths.flat().map((p) => p[0])) - 1e8).toBeCloseTo(
    0.2,
    6,
  );
});
it("the mouse reference points toward face material, including hole boundaries", async () => {
  await useEditor.getState().drawSegments([], rect(4, 3));
  const { g, f, context } = state(),
    r = offsetReference(g, f.id, [0.01, 1, 0], context);
  expect(r.anchor).toEqual([0.01, 1, 0]);
  expect(r.inward[0]).toBeCloseTo(1, 9);
  expect(r.inward[1]).toBeCloseTo(0, 9);
});
it("rejects locked shared-definition offsets without changing document, dirty state or history", async () => {
  const p = componentProject();
  p.nodes["instance/one"].locked = true;
  useEditor.getState().replace(p);
  const node = p.nodes["instance/two"];
  if (node.kind === "legacy-primitive") throw Error("fixture");
  const g = p.geometries[p.definitions[node.definitionId].geometryId!],
    f = Object.values(g.faces)[0],
    before = useEditor.getState();
  const result = await before.editGeometry(
    {
      definitionId: node.definitionId,
      geometryId: g.id,
      kind: "face",
      entityId: f.id,
      occurrencePath: [node.id],
    },
    { kind: "offset-face", faceId: f.id, distance: 0.1 },
  );
  expect(result.status).toBe("rejected");
  expect(useEditor.getState().project).toBe(before.project);
  expect(useEditor.getState().revision).toBe(before.revision);
  expect(isDirty()).toBe(false);
  expect(useEditor.getState().canUndo).toBe(false);
});

it("save waits for a confirmed Offset gesture but never for its preview", async () => {
  await useEditor.getState().drawSegments([], rect(4, 3));
  const { g, f, ref, context, p } = state();
  useOffset
    .getState()
    .begin({
      ref,
      ...offsetReference(g, f.id, [0.01, 1, 0], context),
      revision: useEditor.getState().revision,
      distance: 0,
    });
  await awaitGeometryCommits();
  expect(useEditor.getState().project).toBe(p);
  useOffset.getState().move(0.2);
  useOffset.getState().confirm();
  let saved = false;
  const pending = awaitGeometryCommits().then(() => (saved = true));
  await Promise.resolve();
  expect(saved).toBe(false);
  useOffset.getState().cancel();
  await pending;
  expect(saved).toBe(true);
  expect(useEditor.getState().project).toBe(p);
});
it("cancelled and stale worker-style Offset replies never overwrite current topology", async () => {
  await useEditor.getState().drawSegments([], rect(4, 3));
  const { g, f, context } = state(),
    local = createLocalGeometryBackend(context);
  const pending: {
    request: import("@forma/geometry").GeometryRequest;
    resolve: (r: import("@forma/geometry").GeometryResponse) => void;
  }[] = [];
  const session = new GeometrySession(
    g,
    context,
    {
      propose: (request) =>
        new Promise((resolve) => pending.push({ request, resolve })),
    },
    id("offset-delayed"),
  );
  const first = session.execute({
      kind: "offset-face",
      faceId: f.id,
      distance: 0.2,
    }),
    second = session.execute({
      kind: "offset-face",
      faceId: f.id,
      distance: 0.1,
    });
  pending[1].resolve(await local.propose(pending[1].request));
  expect((await second).status).toBe("applied");
  const current = session.snapshot;
  pending[0].resolve(await local.propose(pending[0].request));
  expect((await first).status).toBe("stale");
  expect(session.snapshot).toBe(current);
  const third = session.prepare({
    kind: "offset-face",
    faceId: Object.keys(current.faces)[0],
    distance: 0.02,
  });
  session.cancelAll();
  pending[2].resolve(await local.propose(pending[2].request));
  expect((await third).status).toBe("cancelled");
  expect(session.snapshot).toBe(current);
});
it("an invalid offset preserves an existing Redo branch and exact IDs", async () => {
  await useEditor.getState().drawSegments([], rect(4, 3));
  const { ref, f } = state();
  await useEditor
    .getState()
    .editGeometry(ref, { kind: "offset-face", faceId: f.id, distance: 0.2 });
  const after = useEditor.getState().project;
  useEditor.getState().undo();
  const before = useEditor.getState();
  expect(before.canRedo).toBe(true);
  expect(
    (
      await before.editGeometry(ref, {
        kind: "offset-face",
        faceId: f.id,
        distance: 2,
      })
    ).status,
  ).toBe("rejected");
  expect(useEditor.getState().project).toBe(before.project);
  expect(useEditor.getState().canRedo).toBe(true);
  useEditor.getState().redo();
  expect(useEditor.getState().project).toEqual(after);
});
