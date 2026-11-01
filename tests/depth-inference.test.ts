import { it, expect } from "vitest";
import {
  resolveDepthSnap,
  depthSnapKinds,
  type SnapCandidate,
  SnapEngine,
  workPlane,
  type SnapQuery,
} from "@forma/snapping";
import { usePushPull } from "@forma/editor";
import { precisionProject } from "./fixtures/precision-project";
const target = (
  point: [number, number, number],
  kind: SnapCandidate["kind"] = "vertex",
): SnapCandidate => ({
  point,
  kind,
  key: "target",
  distance: 0,
  depth: 1,
  label: "Вершина",
  ref: {
    geometryId: "geometry/main",
    definitionId: "definition/root",
    entityId: "vertex/target",
    kind: "vertex",
    occurrencePath: [],
  },
});
it("projects a topology level along a normalized world normal without lateral movement", () => {
  const r = resolveDepthSnap(
    [1, 0, 1],
    [0, 2, 0],
    0.8,
    target([5, 2, 3]),
    null,
  );
  expect(r.distance).toBe(2);
  expect(r.level).toEqual([1, 2, 1]);
  const tilted = resolveDepthSnap(
    [0, 0, 0],
    [1, 1, 0],
    0.5,
    target([2, 2, 9]),
    null,
  );
  expect(tilted.distance).toBeCloseTo(Math.sqrt(8));
  expect(tilted.level![0]).toBeCloseTo(2);
  expect(tilted.level![2]).toBe(0);
});
it("accepts signed recess depths but never certifies a target past the opposite skin", () => {
  expect(
    resolveDepthSnap([0, 0, 0], [0, 0, 1], -0.1, target([2, 0, -0.15]), -0.2)
      .distance,
  ).toBeCloseTo(-0.15);
  expect(
    resolveDepthSnap([0, 0, 0], [0, 0, 1], -0.1, target([2, 0, -0.3]), -0.2)
      .candidate,
  ).toBeNull();
});
it.each(["grid", "axis", "parallel", "origin"] as const)(
  "does not label %s as topology depth",
  (kind) =>
    expect(
      resolveDepthSnap([0, 0, 0], [0, 1, 0], 1, target([0, 2, 0], kind), null)
        .candidate,
    ).toBeNull(),
);
it("rejects absent, zero, nonfinite and unreferenced targets", () => {
  for (const c of [
    null,
    target([2, 0, 3]),
    target([0, NaN, 0]),
    { ...target([0, 2, 0]), ref: undefined },
  ])
    expect(
      resolveDepthSnap([0, 0, 0], [0, 1, 0], 0.7, c, null).candidate,
    ).toBeNull();
  expect(() => resolveDepthSnap([0, 0, 0], [0, 0, 0], 1, null, null)).toThrow();
  expect(() =>
    resolveDepthSnap([0, 0, 0], [0, 1, 0], NaN, null, null),
  ).toThrow();
});
it("preserves numeric input ownership and clears inference on focus, clamping and cancellation", () => {
  const store = usePushPull;
  store.getState().begin({
    ref: target([0, 2, 0]).ref!,
    anchor: [0, 0, 0],
    normal: [0, 1, 0],
    revision: 0,
    side: 1,
    limit: -0.2,
    distance: 0,
  });
  store.getState().move(2, target([0, 2, 0]));
  expect(store.getState().gesture?.snap).toBeTruthy();
  store.getState().setEditing(true);
  store.getState().move(4, target([0, 4, 0]));
  expect(store.getState().gesture?.distance).toBe(2);
  expect(store.getState().gesture?.snap).toBeNull();
  store.getState().setEditing(false);
  store.getState().move(-0.3, target([0, -0.3, 0]));
  expect(store.getState().gesture?.distance).toBe(-0.2);
  expect(store.getState().gesture?.snap).toBeNull();
  store.getState().cancel();
  expect(store.getState().gesture).toBeNull();
});
it("filters Snap Engine kinds before ranking and releases the previous latch", () => {
  const engine = new SnapEngine(precisionProject());
  const q: SnapQuery = {
    cursor: [0, 0],
    project: (p) => ({
      x: p[0] * 100,
      y: p[1] * 100,
      depth: 10 - p[2],
      visible: true,
      w: 1,
    }),
    ray: { origin: [0, 0, 10], direction: [0, 0, -1] },
    plane: workPlane("XY"),
    anchor: [0, 0, 0],
    axes: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    gridStep: 0,
    enabled: true,
    kinds: depthSnapKinds,
  };
  expect(engine.query(q).candidate?.ref).toBeDefined();
  expect(engine.query({ ...q, kinds: [] }).candidate).toBeNull();
  expect(engine.query({ ...q, enabled: false }).candidate).toBeNull();
});

it("preserves the confirmed gesture identity across focus changes until its atomic command completes", () => {
  const store = usePushPull;
  store
    .getState()
    .begin({
      ref: target([0, 2, 0]).ref!,
      anchor: [0, 0, 0],
      normal: [0, 1, 0],
      revision: 0,
      side: 1,
      limit: null,
      distance: 2,
      snap: target([0, 2, 0]),
    });
  const confirmed = store.getState().gesture;
  store.getState().confirm();
  const commitId = store.getState().commitId;
  store.getState().setEditing(true);
  store.getState().setEditing(false);
  store.getState().move(3);
  store.getState().confirm();
  expect(store.getState().gesture).toBe(confirmed);
  expect(store.getState().commitId).toBe(commitId);
  expect(store.getState().gesture?.distance).toBe(2);
  store.getState().cancel();
});
