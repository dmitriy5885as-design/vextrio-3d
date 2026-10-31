import { expect, it } from "vitest";
import {
  createLocalGeometryBackend,
  emptyGeometry,
  GeometrySession,
  id,
  prepareSketch,
  validatePrepared,
  validateGeometry,
  type GeometryModel,
  type Vec3,
  type GeometryBackend,
  type GeometryRequest,
  type GeometryResponse,
} from "@forma/geometry";
import { topology, topologyContext } from "./fixtures/topology";
import { signedArea } from "../packages/geometry/src/sketch-common";
import { projectPoint } from "../packages/geometry/src/math";
const context = {
  ownerDefinitionId: "definition/sketch",
  materialIds: new Set(["material/default"]),
};
const empty = () =>
  emptyGeometry(id("geometry/sketch"), id("definition/sketch"));
const session = (
  model = empty(),
  backend: GeometryBackend = createLocalGeometryBackend(context),
) => new GeometrySession(model, context, backend, id("session/sketch"));
const segment = (a: Vec3, b: Vec3) => ({
  kind: "insert-segments" as const,
  segments: [[a, b]] as [Vec3, Vec3][],
  plane: null,
});
const rectangle: [Vec3, Vec3][] = [
  [
    [0, 0, 0],
    [4, 0, 0],
  ],
  [
    [4, 0, 0],
    [4, 3, 0],
  ],
  [
    [4, 3, 0],
    [0, 3, 0],
  ],
  [
    [0, 3, 0],
    [0, 0, 0],
  ],
];
const inner: [Vec3, Vec3][] = [
  [
    [1, 1, 0],
    [2, 1, 0],
  ],
  [
    [2, 1, 0],
    [2, 2, 0],
  ],
  [
    [2, 2, 0],
    [1, 2, 0],
  ],
  [
    [1, 2, 0],
    [1, 1, 0],
  ],
];
async function draw(s: GeometrySession, lines: [Vec3, Vec3][]) {
  for (const [a, b] of lines)
    expect(await s.execute(segment(a, b))).toEqual({ status: "applied" });
}
function areas(m: GeometryModel) {
  return Object.values(m.faces)
    .map((f) => {
      const area = (lid: string) =>
        signedArea(
          m.loops[lid].coedgeIds.map((cid) => {
            const c = m.coedges[cid],
              e = m.edges[c.edgeId];
            return projectPoint(
              m.vertices[c.direction === 1 ? e.start : e.end].position,
              f.plane,
            );
          }),
        );
      return (
        area(f.outerLoopId) + f.innerLoopIds.reduce((a, l) => a + area(l), 0)
      );
    })
    .sort((a, b) => a - b);
}
it("four 4x3 rectangle edges automatically create one editable 12 m² face", async () => {
  const s = session();
  await draw(s, rectangle);
  expect(Object.keys(s.snapshot.vertices)).toHaveLength(4);
  expect(Object.keys(s.snapshot.edges)).toHaveLength(4);
  expect(areas(s.snapshot)).toEqual([12]);
  expect(Object.keys(s.snapshot.coedges)).toHaveLength(4);
  validateGeometry(s.snapshot, context);
});
it("a diagonal creates exactly two 6 m² cells and one reversible transaction", async () => {
  const s = session();
  await draw(s, rectangle);
  const before = structuredClone(s.snapshot);
  expect(await s.execute(segment([0, 0, 0], [4, 3, 0]))).toEqual({
    status: "applied",
  });
  expect(areas(s.snapshot)).toEqual([6, 6]);
  expect(Object.keys(s.snapshot.edges)).toHaveLength(5);
  const after = structuredClone(s.snapshot);
  expect(s.undo().status).toBe("applied");
  expect(s.snapshot).toEqual(before);
  expect(s.redo().status).toBe("applied");
  expect(s.snapshot).toEqual(after);
});
it("X intersection creates one shared vertex and four atomic edges with split lineage", () => {
  const op = id<"operation">("op/x"),
    first = prepareSketch(
      empty(),
      segment([-2, 0, 0], [2, 0, 0]),
      context,
      id("op/first"),
    ),
    before = validatePrepared(empty(), first, context, id("op/first")),
    change = prepareSketch(before, segment([0, -2, 0], [0, 2, 0]), context, op),
    after = validatePrepared(before, change, context, op);
  expect(Object.keys(after.vertices)).toHaveLength(5);
  expect(Object.keys(after.edges)).toHaveLength(4);
  const center = Object.values(after.vertices).find((v) =>
    v.position.every((n) => n === 0),
  )!;
  expect(
    Object.values(after.edges).filter(
      (e) => e.start === center.id || e.end === center.id,
    ),
  ).toHaveLength(4);
  expect(
    change.lineage
      .find((l) => l.kind === "edge")
      ?.descendants.map((d) => d.parameterRange),
  ).toEqual([
    [0, 0.5],
    [0.5, 1],
  ]);
});
it("T junction splits a boundary while preserving a valid rectangle face", async () => {
  const s = session();
  await draw(s, rectangle);
  const oldFace = Object.keys(s.snapshot.faces)[0];
  expect(await s.execute(segment([2, 0, 0], [2, -1, 0]))).toEqual({
    status: "applied",
  });
  expect(areas(s.snapshot)).toEqual([12]);
  expect(Object.keys(s.snapshot.faces)).toEqual([oldFace]);
  expect(Object.keys(s.snapshot.edges)).toHaveLength(6);
});
it("reversed repeated drawing is a no-op and leaves redo intact", async () => {
  const s = session();
  await draw(s, rectangle);
  await s.execute(segment([0, 0, 0], [4, 3, 0]));
  s.undo();
  const before = structuredClone(s.snapshot),
    revision = s.revision;
  expect(await s.execute(segment([4, 0, 0], [0, 0, 0]))).toEqual({
    status: "noop",
  });
  expect(s.snapshot).toEqual(before);
  expect(s.revision).toBe(revision);
  expect(s.canRedo).toBe(true);
});
it("partial overlaps produce a minimal unique interval set", async () => {
  const s = session();
  await draw(s, [
    [
      [0, 0, 0],
      [4, 0, 0],
    ],
    [
      [2, 0, 0],
      [6, 0, 0],
    ],
  ]);
  expect(Object.keys(s.snapshot.vertices)).toHaveLength(4);
  expect(Object.keys(s.snapshot.edges)).toHaveLength(3);
  expect(Object.keys(s.snapshot.faces)).toHaveLength(0);
});
it("nested rectangle creates an inner face and an annulus, not overlapping faces", async () => {
  const s = session();
  await draw(s, rectangle);
  await draw(s, inner);
  expect(areas(s.snapshot)).toEqual([1, 11]);
  expect(
    Object.values(s.snapshot.faces)
      .map((f) => f.innerLoopIds.length)
      .sort(),
  ).toEqual([0, 1]);
  expect(Object.keys(s.snapshot.bodies)).toHaveLength(1);
});
it("deleting the inner face leaves a real hole which unrelated insertion does not refill", async () => {
  const s = session();
  await draw(s, rectangle);
  await draw(s, inner);
  const innerFace = Object.values(s.snapshot.faces).find(
    (f) => !f.innerLoopIds.length,
  )!;
  expect(
    await s.execute({ kind: "delete-entities", entityIds: [innerFace.id] }),
  ).toEqual({ status: "applied" });
  expect(areas(s.snapshot)).toEqual([11]);
  expect(await s.execute(segment([1.2, 1.2, 0], [1.8, 1.2, 0]))).toEqual({
    status: "applied",
  });
  expect(areas(s.snapshot)).toEqual([11]);
  const boundary = s.snapshot.loops[
    Object.values(s.snapshot.faces)[0].innerLoopIds[0]
  ].coedgeIds.map((c) => s.snapshot.coedges[c].edgeId);
  expect(
    await s.execute({ kind: "make-face", boundaryEdgeIds: boundary }),
  ).toEqual({ status: "applied" });
  expect(areas(s.snapshot)).toEqual([1, 11]);
});
it("skew projected crossings and parallel elevated planes stay separate", async () => {
  const s = session();
  await draw(s, [
    [
      [-2, 0, 0],
      [2, 0, 0],
    ],
    [
      [0, -2, 1],
      [0, 2, 1],
    ],
  ]);
  expect(Object.keys(s.snapshot.vertices)).toHaveLength(4);
  expect(Object.keys(s.snapshot.edges)).toHaveLength(2);
  expect(Object.keys(s.snapshot.bodies)).toHaveLength(2);
});
it("a warped spatial contour remains wire without a false planar face", async () => {
  const s = session();
  await draw(s, [
    [
      [0, 0, 0],
      [4, 0, 0],
    ],
    [
      [4, 0, 0],
      [4, 3, 0],
    ],
    [
      [4, 3, 0],
      [0, 3, 1],
    ],
    [
      [0, 3, 1],
      [0, 0, 0],
    ],
  ]);
  expect(Object.keys(s.snapshot.faces)).toHaveLength(0);
  expect(Object.keys(s.snapshot.edges)).toHaveLength(4);
});
it("near endpoints weld under policy but outside-tolerance endpoints do not close", async () => {
  const s = session();
  await draw(s, rectangle.slice(0, 3));
  expect(await s.execute(segment([0, 3, 0], [0, 5e-8, 0]))).toEqual({
    status: "applied",
  });
  expect(areas(s.snapshot)).toEqual([12]);
  const far = session();
  await draw(far, rectangle.slice(0, 3));
  expect(await far.execute(segment([0, 3, 0], [0, 5e-6, 0]))).toEqual({
    status: "applied",
  });
  expect(Object.keys(far.snapshot.faces)).toHaveLength(0);
});
it.each([
  [
    [0, 0, 0],
    [0, 0, 0],
  ],
  [
    [0, 0, 0],
    [1e-9, 0, 0],
  ],
  [
    [NaN, 0, 0],
    [2, 0, 0],
  ],
] as [Vec3, Vec3][])(
  "invalid insertion is atomic including history and redo",
  async (a, b) => {
    const s = session();
    await draw(s, rectangle);
    await s.execute(segment([0, 0, 0], [4, 3, 0]));
    s.undo();
    const before = structuredClone(s.snapshot),
      revision = s.revision;
    expect((await s.execute(segment(a, b))).status).toBe("error");
    expect(s.snapshot).toEqual(before);
    expect(s.revision).toBe(revision);
    expect(s.canRedo).toBe(true);
  },
);
it("a declared plane rejects off-plane input before any mutation", async () => {
  const s = session();
  const result = await s.execute({
    kind: "insert-segments",
    segments: [
      [
        [0, 0, 0],
        [1, 0, 1],
      ],
    ],
    plane: { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, 1] },
  });
  expect(result.status).toBe("error");
  expect(s.snapshot).toEqual(empty());
});
it("preview, cancellation and stale insertion proposals retain the S2 guarantees", async () => {
  const jobs: {
      request: GeometryRequest;
      resolve: (r: GeometryResponse) => void;
    }[] = [],
    backend: GeometryBackend = {
      propose: (request) =>
        new Promise((resolve) => jobs.push({ request, resolve })),
    },
    s = session(empty(), backend),
    local = createLocalGeometryBackend(context);
  const a = s.execute(segment([0, 0, 0], [1, 0, 0])),
    b = s.execute(segment([0, 0, 0], [0, 1, 0]));
  jobs[1].resolve(await local.propose(jobs[1].request));
  expect((await b).status).toBe("applied");
  jobs[0].resolve(await local.propose(jobs[0].request));
  expect((await a).status).toBe("stale");
  const c = s.execute(segment([0, 0, 0], [0, 0, 1]));
  s.cancelAll();
  jobs[2].resolve(await local.propose(jobs[2].request));
  expect((await c).status).toBe("cancelled");
  const p = session();
  const preview = await p.execute(segment([0, 0, 0], [1, 0, 0]), "preview");
  expect(preview.status).toBe("preview");
  expect(p.snapshot).toEqual(empty());
  expect(p.canUndo).toBe(false);
});
it("three concurrent lines share one vertex and six pieces", async () => {
  const s = session();
  await draw(s, [
    [
      [-2, 0, 0],
      [2, 0, 0],
    ],
    [
      [0, -2, 0],
      [0, 2, 0],
    ],
    [
      [-2, -2, 0],
      [2, 2, 0],
    ],
  ]);
  expect(Object.keys(s.snapshot.vertices)).toHaveLength(7);
  expect(Object.keys(s.snapshot.edges)).toHaveLength(6);
  expect(Object.keys(s.snapshot.faces)).toHaveLength(0);
});
it("endpoint-only contact reuses both vertex and unaffected edge ID", async () => {
  const s = session();
  await draw(s, [
    [
      [0, 0, 0],
      [2, 0, 0],
    ],
  ]);
  const old = Object.keys(s.snapshot.edges)[0];
  await draw(s, [
    [
      [2, 0, 0],
      [2, 2, 0],
    ],
  ]);
  expect(Object.keys(s.snapshot.vertices)).toHaveLength(3);
  expect(s.snapshot.edges[old]).toBeDefined();
});
it("batch permutation and reversed directions produce equivalent subdivisions", async () => {
  const lines: [Vec3, Vec3][] = [
    ...rectangle,
    [
      [0, 0, 0],
      [4, 3, 0],
    ],
    [
      [2, -1, 0],
      [2, 4, 0],
    ],
  ];
  const a = session(),
    b = session();
  expect(
    (await a.execute({ kind: "insert-segments", segments: lines, plane: null }))
      .status,
  ).toBe("applied");
  expect(
    (
      await b.execute({
        kind: "insert-segments",
        segments: [...lines].reverse().map(([a, b]) => [b, a]),
        plane: null,
      })
    ).status,
  ).toBe("applied");
  expect(areas(a.snapshot)).toEqual(areas(b.snapshot));
  expect(Object.keys(a.snapshot.edges).length).toBe(
    Object.keys(b.snapshot.edges).length,
  );
  expect(areas(a.snapshot).reduce((n, a) => n + a, 0)).toBe(12);
});
it("a concave L shape is a bounded face while dangling branches are not boundaries", async () => {
  const s = session(),
    points: Vec3[] = [
      [0, 0, 0],
      [3, 0, 0],
      [3, 1, 0],
      [1, 1, 0],
      [1, 3, 0],
      [0, 3, 0],
    ];
  await draw(
    s,
    points.map((p, i) => [p, points[(i + 1) % points.length]]),
  );
  expect(areas(s.snapshot)).toEqual([5]);
  await draw(s, [
    [
      [3, 0, 0],
      [4, 0, 0],
    ],
  ]);
  expect(areas(s.snapshot)).toEqual([5]);
});
it("two nested internal rings form three disjoint cells with total area conserved", async () => {
  const s = session();
  await draw(s, rectangle);
  await draw(s, inner);
  const points: Vec3[] = [
    [1.2, 1.2, 0],
    [1.8, 1.2, 0],
    [1.8, 1.8, 0],
    [1.2, 1.8, 0],
  ];
  await draw(
    s,
    points.map((p, i) => [p, points[(i + 1) % 4]]),
  );
  const a = areas(s.snapshot);
  expect(a).toHaveLength(3);
  expect(a[0]).toBeCloseTo(0.36);
  expect(a[1]).toBeCloseTo(0.64);
  expect(a[2]).toBeCloseTo(11);
});
it("stacked closed contours do not weld in screen projection", async () => {
  const s = session();
  await draw(s, rectangle);
  await draw(
    s,
    rectangle.map(([a, b]) => [
      [a[0], a[1], 2],
      [b[0], b[1], 2],
    ]),
  );
  expect(areas(s.snapshot)).toEqual([12, 12]);
  expect(Object.keys(s.snapshot.bodies)).toHaveLength(2);
});
it("splitting a shared boundary updates every coedge use on perpendicular planes", async () => {
  const m = topology(
    [
      [0, 0, 0],
      [4, 0, 0],
      [4, 3, 0],
      [0, 3, 0],
      [4, 0, 2],
      [0, 0, 2],
    ],
    [
      [0, 1, 2, 3],
      [1, 0, 5, 4],
    ],
  );
  const s = new GeometrySession(
    m,
    topologyContext,
    createLocalGeometryBackend(topologyContext),
    id("session/walls"),
  );
  expect(await s.execute(segment([2, 0, 0], [2, 3, 0]))).toEqual({
    status: "applied",
  });
  expect(areas(s.snapshot)).toEqual([6, 6, 8]);
  validateGeometry(s.snapshot, topologyContext);
});
it("different geometry contexts at coincident coordinates have disjoint IDs and histories", async () => {
  const a = session(),
    model = emptyGeometry(id("geometry/other"), id("definition/other")),
    ctx = { ...context, ownerDefinitionId: "definition/other" },
    b = new GeometrySession(
      model,
      ctx,
      createLocalGeometryBackend(ctx),
      id("session/other"),
    );
  await draw(a, rectangle);
  await draw(b, rectangle);
  const ids = new Set(Object.keys(a.snapshot.vertices));
  expect(Object.keys(b.snapshot.vertices).some((v) => ids.has(v))).toBe(false);
  const other = structuredClone(b.snapshot);
  a.undo();
  expect(b.snapshot).toEqual(other);
});
it("a closed component definition remains isolated from another component definition", async () => {
  const a = session(),
    model = emptyGeometry(id("geometry/component"), id("definition/component")),
    ctx = { ...context, ownerDefinitionId: "definition/component" },
    b = new GeometrySession(
      model,
      ctx,
      createLocalGeometryBackend(ctx),
      id("session/component"),
    );
  await draw(a, rectangle);
  await draw(b, [
    [
      [0, 0, 0],
      [4, 3, 0],
    ],
  ]);
  expect(areas(a.snapshot)).toEqual([12]);
  expect(Object.keys(b.snapshot.faces)).toHaveLength(0);
  expect(Object.keys(a.snapshot.edges)).toHaveLength(4);
});
it("world-metric tolerance is respected for a nonuniform placement", async () => {
  const ctx = {
      ...context,
      placement: {
        translation: [8, 2, -4] as Vec3,
        rotation: [0, 0, 0, 1] as [number, number, number, number],
        scale: [2, 3, 1] as Vec3,
      },
    },
    s = new GeometrySession(
      empty(),
      ctx,
      createLocalGeometryBackend(ctx),
      id("session/scaled"),
    );
  await draw(s, rectangle);
  expect(areas(s.snapshot)).toEqual([12]);
  expect(Object.keys(s.snapshot.faces)).toHaveLength(1);
  expect(await s.execute(segment([0, 0, 0], [4, 3, 0]))).toEqual({
    status: "applied",
  });
  expect(areas(s.snapshot)).toEqual([6, 6]);
});
it("rejects a tolerance bridge that would make endpoint identity ambiguous", async () => {
  const s = session(),
    result = await s.execute({
      kind: "insert-segments",
      segments: [
        [
          [0, 0, 0],
          [0, 1, 0],
        ],
        [
          [1.5e-7, 0, 0],
          [1, 1, 0],
        ],
        [
          [0.75e-7, 0, 0],
          [-1, 1, 0],
        ],
      ],
      plane: null,
    });
  expect(result.status).toBe("error");
  if (result.status === "error")
    expect(result.diagnostics[0].code).toBe("NUMERICAL_AMBIGUITY");
  expect(s.snapshot).toEqual(empty());
});
it("unknown contexts, invalid make-face and resource excess fail without changing history", async () => {
  const s = session();
  expect(
    (await s.execute({ kind: "make-face", boundaryEdgeIds: [] })).status,
  ).toBe("error");
  expect(
    (
      await s.execute({
        kind: "insert-segments",
        segments: Array.from(
          { length: 257 },
          () =>
            [
              [0, 0, 0],
              [1, 0, 0],
            ] as [Vec3, Vec3],
        ),
        plane: null,
      })
    ).status,
  ).toBe("error");
  expect(s.snapshot).toEqual(empty());
  expect(s.canUndo).toBe(false);
});
it("multiple holes and a bridge retain disjoint cells and stable face IDs", async () => {
  const s = session();
  await draw(s, rectangle);
  await draw(s, inner);
  const second: Vec3[] = [
    [2.5, 1, 0],
    [3.5, 1, 0],
    [3.5, 2, 0],
    [2.5, 2, 0],
  ];
  await draw(
    s,
    second.map((p, i) => [p, second[(i + 1) % 4]]),
  );
  expect(areas(s.snapshot)).toEqual([1, 1, 10]);
  const ids = Object.keys(s.snapshot.faces).sort();
  expect(await s.execute(segment([0, 1, 0], [1, 1, 0]))).toEqual({
    status: "applied",
  });
  expect(areas(s.snapshot)).toEqual([1, 1, 10]);
  expect(Object.keys(s.snapshot.faces).sort()).toEqual(ids);
});
it("unaffected oppositely oriented coplanar faces retain IDs and front/back orientation", async () => {
  const m = topology(
    [
      [0, 0, 0],
      [2, 0, 0],
      [2, 2, 0],
      [0, 2, 0],
      [4, 0, 0],
      [6, 0, 0],
      [6, 2, 0],
      [4, 2, 0],
    ],
    [
      [0, 1, 2, 3],
      [7, 6, 5, 4],
    ],
  );
  delete m.bodies["body/0"];
  for (const [i, vs, es, fs] of [
    [0, [0, 1, 2, 3], [0, 1, 2, 3], ["f/0"]],
    [1, [4, 5, 6, 7], [4, 5, 6, 7], ["f/1"]],
  ] as const) {
    const key = id<"body">(`body/${i}`);
    m.bodies[key] = {
      id: key,
      vertexIds: vs.map((v) => id(`v/${v}`)),
      edgeIds: es.map((e) => id(`e/${e}`)),
      faceIds: fs.map((f) => id(f)),
      shellIds: [],
    };
  }
  const s = new GeometrySession(
    m,
    topologyContext,
    createLocalGeometryBackend(topologyContext),
    id("session/opposite"),
  );
  const old = structuredClone(m.faces["f/1"]);
  expect(await s.execute(segment([0, 0, 0], [2, 2, 0]))).toEqual({
    status: "applied",
  });
  expect(s.snapshot.faces["f/1"]).toEqual(old);
});
it("translating the same input to large coordinates preserves area and cell counts", async () => {
  const s = session();
  await draw(
    s,
    rectangle.map(([a, b]) => [
      [a[0] + 1e8, a[1] + 1e8, a[2]],
      [b[0] + 1e8, b[1] + 1e8, b[2]],
    ]),
  );
  expect(areas(s.snapshot)).toEqual([12]);
});
it("body merge and face split expose resolvable provenance rather than deleting references", () => {
  let m = empty();
  for (const [i, line] of rectangle.entries()) {
    const op = id<"operation">(`trace/${i}`),
      change = prepareSketch(m, segment(...line), context, op);
    m = validatePrepared(m, change, context, op);
  }
  const op = id<"operation">("trace/diagonal"),
    change = prepareSketch(m, segment([0, 0, 0], [4, 3, 0]), context, op);
  expect(change.lineage.find((l) => l.kind === "face")?.reason).toBe("split");
  expect(
    change.lineage.find((l) => l.kind === "loop")?.descendants,
  ).toHaveLength(2);
});
it("deduplicates pre-existing coincident edges from an S2 model with reversible merge lineage", async () => {
  const m = topology(
    [
      [0, 0, 0],
      [2, 0, 0],
    ],
    [],
    [[0, 1]],
  );
  m.edges["e/1"] = {
    ...m.edges["e/0"],
    id: id("e/1"),
    start: id("v/1"),
    end: id("v/0"),
  };
  m.bodies["body/0"].edgeIds.push(id("e/1"));
  const s = new GeometrySession(
    m,
    topologyContext,
    createLocalGeometryBackend(topologyContext),
    id("session/duplicates"),
  );
  expect(await s.execute(segment([0, 0, 0], [2, 0, 0]))).toEqual({
    status: "applied",
  });
  expect(Object.keys(s.snapshot.edges)).toHaveLength(1);
  s.undo();
  expect(s.snapshot).toEqual(m);
});
it("canonicalizes existing nearly coincident vertices without losing exact Undo IDs", async () => {
  const m = topology(
    [
      [0, 0, 0],
      [2, 0, 0],
      [0, 5e-8, 0],
      [0, 2, 0],
    ],
    [],
    [
      [0, 1],
      [2, 3],
    ],
  );
  m.bodies["body/0"].vertexIds = [id("v/0"), id("v/1")];
  m.bodies["body/0"].edgeIds = [id("e/0")];
  m.bodies["body/1"] = {
    id: id("body/1"),
    vertexIds: [id("v/2"), id("v/3")],
    edgeIds: [id("e/1")],
    faceIds: [],
    shellIds: [],
  };
  const s = new GeometrySession(
    m,
    topologyContext,
    createLocalGeometryBackend(topologyContext),
    id("session/weld"),
  );
  expect(
    await s.execute({ kind: "insert-segments", segments: [], plane: null }),
  ).toEqual({ status: "applied" });
  expect(Object.keys(s.snapshot.vertices)).toHaveLength(3);
  expect(Object.keys(s.snapshot.bodies)).toHaveLength(1);
  s.undo();
  expect(s.snapshot).toEqual(m);
});
it("merging fully coincident bodies retires both body IDs into one new descendant", () => {
  const m = topology(
    [
      [0, 0, 0],
      [2, 0, 0],
      [0, 0, 0],
      [2, 0, 0],
    ],
    [],
    [
      [0, 1],
      [2, 3],
    ],
  );
  m.bodies["body/0"].vertexIds = [id("v/0"), id("v/1")];
  m.bodies["body/0"].edgeIds = [id("e/0")];
  m.bodies["body/1"] = {
    id: id("body/1"),
    vertexIds: [id("v/2"), id("v/3")],
    edgeIds: [id("e/1")],
    faceIds: [],
    shellIds: [],
  };
  const operationId = id<"operation">("merge/bodies"),
    change = prepareSketch(
      m,
      { kind: "insert-segments", segments: [], plane: null },
      topologyContext,
      operationId,
    ),
    after = validatePrepared(m, change, topologyContext, operationId),
    parents = change.lineage.filter((l) => l.kind === "body");
  expect(Object.keys(after.bodies)).toHaveLength(1);
  expect(parents).toHaveLength(2);
  expect(
    parents.every(
      (l) =>
        l.reason === "merge" &&
        l.descendants[0].id === Object.keys(after.bodies)[0],
    ),
  ).toBe(true);
});

it("exact welded endpoints preserve slanted edge IDs despite fractional intersection roundoff", async () => {
  const s = session(),
    a: Vec3 = [1 - Math.cos(Math.PI / 12), Math.sin(Math.PI / 12), 0],
    b: Vec3 = [1 - Math.cos(Math.PI / 6), Math.sin(Math.PI / 6), 0];
  await s.execute(segment(a, b));
  const before = structuredClone(s.snapshot),
    revision = s.revision;
  expect(await s.execute(segment(b, a))).toEqual({ status: "noop" });
  expect(s.snapshot).toEqual(before);
  expect(s.revision).toBe(revision);
});
