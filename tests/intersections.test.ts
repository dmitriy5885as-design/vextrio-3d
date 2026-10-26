import { expect, it } from "vitest";
import { segmentIntersections } from "../packages/geometry/src/intersections";
import { splitSegments } from "../packages/geometry/src/edge-builder";
import { id, type Vec3 } from "@forma/geometry";
import { wire, sheet, topologyContext } from "./fixtures/topology";
const hits = (a: Vec3, b: Vec3, c: Vec3, d: Vec3) =>
  segmentIntersections(a, b, c, d, 1e-7);
it("S3.1 classifies proper X and endpoint T with exact parameter ranges", () => {
  expect(hits([-2, 0, 0], [2, 0, 0], [0, -2, 0], [0, 2, 0])).toEqual([
    { a: 0.5, b: 0.5, point: [0, 0, 0] },
  ]);
  expect(hits([0, 0, 0], [4, 0, 0], [2, 0, 0], [2, 3, 0])).toEqual([
    { a: 0.5, b: 0, point: [2, 0, 0] },
  ]);
});
it("S3.1 overlap returns both interval boundaries, including reversed direction", () => {
  const a = hits([0, 0, 0], [4, 0, 0], [6, 0, 0], [2, 0, 0]);
  expect(a.map((h) => h.point[0]).sort()).toEqual([2, 4]);
  expect(a.find((h) => h.point[0] === 2)?.a).toBe(0.5);
  expect(a.find((h) => h.point[0] === 4)?.b).toBe(0.5);
});
it.each([
  [
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 0],
    [3, 0, 0],
  ],
  [
    [0, 0, 0],
    [2, 0, 0],
    [1, -1, 1],
    [1, 1, 1],
  ],
  [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
  ],
] as [Vec3, Vec3, Vec3, Vec3][])(
  "S3.1 rejects disjoint/skew/parallel cases",
  (a, b, c, d) => {
    expect(hits(a, b, c, d)).toHaveLength(0);
  },
);
it("S3.1 supports a real 3D crossing on an oblique plane", () => {
  const h = hits([-1, -1, -1], [1, 1, 1], [-1, 1, 0], [1, -1, 0]);
  expect(h).toHaveLength(1);
  h[0].point.forEach((n) => expect(n).toBeCloseTo(0, 12));
});
it("S3.1 never invents a crossing for a nearly parallel skew pair", () => {
  expect(hits([0, 0, 0], [1e6, 0, 0], [0, -1, 1], [1e6, 1, 1])).toHaveLength(0);
});
it.each([0, 1e-9])("S3.1 rejects a degenerate source of length %s", (n) =>
  expect(() => hits([0, 0, 0], [n, 0, 0], [0, -1, 0], [0, 1, 0])).toThrow(
    /shorter/,
  ),
);
it("S3.1 split candidate preserves input, retains remote edge IDs and records lineage", () => {
  const before = wire(),
    snapshot = structuredClone(before),
    result = splitSegments(
      before,
      [
        [
          [1, -1, 0],
          [1, 1, 0],
        ],
      ],
      topologyContext,
      id("operation/split"),
    );
  expect(before).toEqual(snapshot);
  expect(Object.keys(result.model.edges)).toHaveLength(4);
  expect(
    result.lineage
      .find((l) => l.kind === "edge")
      ?.descendants.map((d) => d.parameterRange),
  ).toEqual([
    [0, 0.5],
    [0.5, 1],
  ]);
});
it("S3.1 updates an existing oriented contour use after boundary split", () => {
  const before = sheet(),
    result = splitSegments(
      before,
      [
        [
          [1, 0, 0],
          [1, -1, 0],
        ],
      ],
      topologyContext,
      id("operation/t"),
    );
  expect(result.model.loops["l/0"].coedgeIds).toHaveLength(5);
  const start = (cid: string) => {
      const c = result.model.coedges[cid],
        e = result.model.edges[c.edgeId];
      return c.direction === 1 ? e.start : e.end;
    },
    end = (cid: string) => {
      const c = result.model.coedges[cid],
        e = result.model.edges[c.edgeId];
      return c.direction === 1 ? e.end : e.start;
    },
    ids = result.model.loops["l/0"].coedgeIds;
  expect(
    ids.every((cid, i) => end(cid) === start(ids[(i + 1) % ids.length])),
  ).toBe(true);
});
it("a near-parallel proper intersection is not misclassified from angle alone", () => {
  const a: [Vec3, Vec3] = [
      [0, 0, 0],
      [1e6, 0, 0],
    ],
    b: [Vec3, Vec3] = [
      [0, -1e-5, 0],
      [1e6, 1e-5, 0],
    ];
  const h = segmentIntersections(...a, ...b, 1e-7, 1e-10);
  expect(
    h.some((p) => Math.abs(p.a - 0.5) < 1e-10 && Math.abs(p.b - 0.5) < 1e-10),
  ).toBe(true);
});
