import { beforeEach, expect, it, vi } from "vitest";
import {
  arcProfile,
  arcChordFrame,
  add,
  multiply,
  subtract,
  length,
  dot,
  tessellateFace,
  bodyVolume,
  classifyBody,
  transformAffine,
  type Vec3,
} from "@forma/geometry";
import { ToolController } from "@forma/tools";
import { workPlane } from "@forma/snapping";
import {
  useEditor,
  usePrecision,
  sketchController,
  isDirty,
} from "@forma/editor";
import {
  emptyProject,
  emptyProjectV2,
  parseProject,
  serializeProject,
  occurrenceMatrix,
  type ProjectV2,
} from "@forma/document";
import { componentProject } from "./fixtures/v2-project";

beforeEach(() => {
  useEditor.getState().setTool("select");
  useEditor.getState().replace(emptyProjectV2());
  usePrecision
    .getState()
    .configure({ planeName: "XZ", path: [], system: "world", axis: null });
  sketchController.setArcSides(12, workPlane("XZ"));
});
it.each(["XY", "XZ", "YZ"] as const)(
  "makes a signed circular arc with exact endpoints in %s",
  (name) => {
    const plane = workPlane(name),
      a: Vec3 = [2, 3, 4],
      b = add(a, multiply(plane.u, 2));
    for (const h of [-2, -1, -0.1, 0.1, 1, 2]) {
      const mid = add(a, plane.u),
        p = add(mid, multiply(plane.v, h)),
        arc = arcProfile(a, b, p, plane);
      expect(arc.segments).toHaveLength(12);
      expect(arc.segments[0][0]).toEqual(a);
      expect(arc.segments.at(-1)![1]).toEqual(b);
      expect(arc.bulge).toBeCloseTo(h, 10);
      expect(arc.radius).toBeCloseTo((1 + h * h) / (2 * Math.abs(h)), 10);
      expect(Math.sign(arc.sweep)).toBe(-Math.sign(h));
      expect(
        arc.segments.some(([q]) => JSON.stringify(q) === JSON.stringify(p)),
      ).toBe(true);
      for (const [q] of arc.segments) {
        expect(length(subtract(q, arc.center))).toBeCloseTo(arc.radius, 9);
        expect(dot(subtract(q, a), plane.normal)).toBeCloseTo(0, 10);
      }
    }
  },
);
it("retains an off-midpoint snapped point while respecting the segment budget", () => {
  const a: Vec3 = [0, 0, 0],
    b: Vec3 = [2, 0, 0],
    p: Vec3 = [0.3, 0.7, 0];
  for (const n of [2, 3, 12, 24, 128]) {
    const arc = arcProfile(a, b, p, workPlane("XY"), n);
    expect(arc.segments).toHaveLength(n);
    expect(arc.segments.some(([q]) => q.every((v, i) => v === p[i]))).toBe(
      true,
    );
    expect(arc.segments.at(-1)![1]).toEqual(b);
    arc.segments.forEach(([q]) =>
      expect(length(subtract(q, arc.center))).toBeCloseTo(arc.radius, 9),
    );
  }
});
it("keeps a shallow sagitta instead of flattening it by cosine cancellation", () => {
  const arc = arcProfile(
    [0, 0, 0],
    [1000, 0, 0],
    [500, 0.0001, 0],
    workPlane("XY"),
  );
  expect(arc.bulge).toBeCloseTo(0.0001, 12);
  expect(arc.segments[2][1][1]).toBeGreaterThan(0.00007);
  expect(arc.segments.some(([p]) => p[1] === 0.0001)).toBe(true);
});
it("rejects coincident, collinear, off-plane, nonfinite and undersized inputs", () => {
  const plane = workPlane("XY");
  for (const [b, p] of [
    [
      [0, 0, 0],
      [1, 1, 0],
    ],
    [
      [2, 0, 0.1],
      [1, 1, 0],
    ],
    [
      [2, 0, 0],
      [1, 0, 0],
    ],
    [
      [2, 0, 0],
      [0, 0, 0],
    ],
    [
      [2, 0, 0],
      [1, 1, 0.1],
    ],
    [
      [2, 0, 0],
      [NaN, 1, 0],
    ],
    [
      [2, 0, 0],
      [1, 1e-8, 0],
    ],
  ] as [Vec3, Vec3][])
    expect(() => arcProfile([0, 0, 0], b, p, plane)).toThrow();
  for (const sides of [0, 1, 2.5, 129, Infinity])
    expect(() =>
      arcProfile([0, 0, 0], [2, 0, 0], [1, 1, 0], plane, sides),
    ).toThrow();
  expect(() => arcChordFrame([0, 0, 0], [2, 0, 0], plane, -1)).toThrow();
});
it("two endpoint clicks and resolution changes never call a geometry commit", async () => {
  const preview = vi.fn(async () => ({ status: "preview" as const })),
    commit = vi.fn(async () => ({ status: "applied" as const }));
  const c = new ToolController({ preview, commit }, 0),
    plane = workPlane("XZ");
  c.activate("arc");
  await c.click([0, 0, 0], plane, "a");
  c.move([2, 0, 0], plane);
  expect(c.state.segments).toHaveLength(1);
  expect(c.state.preview).toBeNull();
  await c.click([2, 0, 0], plane, "b");
  expect(c.state.arcEnd).toEqual([2, 0, 0]);
  expect(commit).not.toHaveBeenCalled();
  expect(preview).not.toHaveBeenCalled();
  c.move([1, 0, 1], plane);
  c.setArcSides(24, plane);
  expect(c.state.segments).toHaveLength(24);
  expect(c.setArcSides(1, plane)).toBe(false);
  expect(c.state.arcSides).toBe(24);
  c.cancel();
  expect(c.state.arcEnd).toBeNull();
  expect(commit).not.toHaveBeenCalled();
});
it("commits one open arc, closes its face with a line, extrudes and restores topology/IDs through history and files", async () => {
  const before = useEditor.getState().project,
    plane = workPlane("XZ");
  useEditor.getState().setTool("arc");
  await sketchController.click([0, 0, 0], plane, "a");
  await sketchController.click([2, 0, 0], plane, "b");
  expect(useEditor.getState().project).toBe(before);
  expect(isDirty()).toBe(false);
  expect(useEditor.getState().canUndo).toBe(false);
  sketchController.move([1, 0, 1], plane);
  expect(useEditor.getState().project).toBe(before);
  await sketchController.click([1, 0, 1], plane, "p");
  const open = useEditor.getState().project as ProjectV2,
    g = Object.values(open.geometries)[0];
  expect(Object.keys(g.edges)).toHaveLength(12);
  expect(Object.keys(g.vertices)).toHaveLength(13);
  expect(Object.keys(g.faces)).toHaveLength(0);
  await sketchController.click([1, 0, 1], plane, "p");
  expect(useEditor.getState().project).toBe(open);
  useEditor.getState().undo();
  expect(useEditor.getState().project).toEqual(before);
  useEditor.getState().redo();
  expect(useEditor.getState().project).toEqual(open);
  expect(
    (
      await useEditor.getState().drawSegments(
        [],
        [
          [
            [2, 0, 0],
            [0, 0, 0],
          ],
        ],
      )
    ).status,
  ).toBe("applied");
  const closed = useEditor.getState().project as ProjectV2,
    m = closed.geometries[g.id],
    f = Object.values(m.faces)[0],
    area = 6 * Math.sin(Math.PI / 12);
  expect(Object.keys(m.faces)).toHaveLength(1);
  expect(Object.keys(m.edges)).toHaveLength(13);
  expect(tessellateFace(m, f).area).toBeCloseTo(area, 9);
  const ref = {
    definitionId: m.ownerDefinitionId,
    geometryId: m.id,
    kind: "face" as const,
    entityId: f.id,
    occurrencePath: [],
  };
  expect(
    (
      await useEditor.getState().editGeometry(ref, {
        kind: "extrude-face",
        faceId: f.id,
        distance: 2,
        side: 1,
      })
    ).status,
  ).toBe("applied");
  const solid = useEditor.getState().project as ProjectV2,
    mg = solid.geometries[g.id],
    body = Object.values(mg.bodies)[0];
  expect(classifyBody(mg, body.id)).toBe("closed-shell");
  expect(bodyVolume(mg, body.id)).toBeCloseTo(2 * area, 9);
  expect(Object.keys(mg.vertices)).toHaveLength(26);
  expect(Object.keys(mg.edges)).toHaveLength(39);
  expect(Object.keys(mg.faces)).toHaveLength(15);
  expect(parseProject(serializeProject(solid))).toEqual(
    JSON.parse(JSON.stringify(solid)),
  );
  useEditor.getState().undo();
  expect(useEditor.getState().project).toEqual(closed);
  useEditor.getState().redo();
  expect(useEditor.getState().project).toEqual(solid);
});
it("invalid bulge and cancel leave the document, dirty state and undo unchanged", async () => {
  useEditor.getState().setTool("arc");
  const p = useEditor.getState().project,
    plane = workPlane("XZ");
  await sketchController.click([0, 0, 0], plane, "a");
  await sketchController.click([2, 0, 0], plane, "b");
  await sketchController.click([1, 0, 0], plane, "bad");
  expect(sketchController.state.error).not.toBe("");
  expect(useEditor.getState().project).toBe(p);
  expect(isDirty()).toBe(false);
  expect(useEditor.getState().canUndo).toBe(false);
  sketchController.cancel();
  expect(sketchController.state.start).toBeNull();
  expect(sketchController.state.arcEnd).toBeNull();
});
it("isolates an arc in a nonuniformly transformed group and keeps its physical dimensions", async () => {
  const p = componentProject(),
    node = p.nodes["instance/group"];
  if (node.kind === "legacy-primitive") throw Error("fixture");
  node.transform.scale = [2, 3, 4];
  useEditor.getState().replace(p);
  const arc = arcProfile([0, 0, 0], [2, 0, 0], [1, 0, 1], workPlane("XZ"));
  expect(
    (await useEditor.getState().drawSegments([node.id], arc.segments)).status,
  ).toBe("applied");
  const after = useEditor.getState().project as ProjectV2,
    gid = after.definitions[node.definitionId].geometryId!,
    g = after.geometries[gid],
    matrix = occurrenceMatrix(after, [node.id]);
  expect(after.geometries["native/geometry"]).toEqual(
    p.geometries["native/geometry"],
  );
  expect(after.nodes).toEqual(p.nodes);
  for (const v of Object.values(g.vertices))
    expect(
      length(subtract(transformAffine(v.position, matrix), [1, 0, 0])),
    ).toBeCloseTo(1, 9);
});
it("requires explicit v1 migration before enabling A", () => {
  useEditor.getState().replace(emptyProject());
  useEditor.getState().setTool("arc");
  expect(useEditor.getState().tool).toBe("select");
  useEditor.getState().upgradeProject();
  useEditor.getState().setTool("arc");
  expect(useEditor.getState().tool).toBe("arc");
});
it("discards delayed arc previews and cancelled commits by generation", async () => {
  let previewAccept: () => boolean = () => true,
    commitAccept: () => boolean = () => true;
  let finishPreview: (v: any) => void = () => {},
    finishCommit: (v: any) => void = () => {};
  const c = new ToolController(
      {
        preview: async (_, accept) => {
          previewAccept = accept;
          return new Promise((r) => (finishPreview = r));
        },
        commit: async (_, accept) => {
          commitAccept = accept;
          return new Promise((r) => (finishCommit = r));
        },
      },
      0,
    ),
    plane = workPlane("XZ");
  c.activate("arc");
  await c.click([0, 0, 0], plane, "a");
  await c.click([2, 0, 0], plane, "b");
  c.move([1, 0, 1], plane);
  await new Promise((r) => setTimeout(r, 1));
  c.cancel();
  expect(previewAccept()).toBe(false);
  finishPreview({ status: "preview" });
  await c.click([0, 0, 0], plane, "a2");
  await c.click([2, 0, 0], plane, "b2");
  const pending = c.click([1, 0, 1], plane, "c2");
  c.cancel();
  expect(commitAccept()).toBe(false);
  finishCommit({ status: "applied" });
  await pending;
  expect(c.state.phase).toBe("Idle");
  expect(c.state.arcEnd).toBeNull();
});

it("reversing endpoints preserves the same odd-segment polygon", () => {
  for (const point of [
    [1, 1, 0],
    [0.3, 0.7, 0],
  ] as Vec3[])
    for (const sides of [3, 7, 12]) {
      const a = arcProfile([0, 0, 0], [2, 0, 0], point, workPlane("XY"), sides),
        b = arcProfile([2, 0, 0], [0, 0, 0], point, workPlane("XY"), sides);
      a.segments.forEach(([p, q], i) => {
        const [v, u] = b.segments[sides - 1 - i];
        p.forEach((x, k) => expect(x).toBeCloseTo(u[k], 9));
        q.forEach((x, k) => expect(x).toBeCloseTo(v[k], 9));
      });
    }
});
it("redrawing the same arc is a no-op and a crossing line really splits an arc segment", async () => {
  const plane = workPlane("XY");
  expect(
    (
      await useEditor
        .getState()
        .drawSegments(
          [],
          arcProfile([0, 0, 0], [2, 0, 0], [1, 1, 0], plane).segments,
        )
    ).status,
  ).toBe("applied");
  const before = useEditor.getState().project;
  expect(
    (
      await useEditor
        .getState()
        .drawSegments(
          [],
          arcProfile([2, 0, 0], [0, 0, 0], [1, 1, 0], plane).segments,
        )
    ).status,
  ).toBe("noop");
  expect(useEditor.getState().project).toBe(before);
  expect(
    (
      await useEditor.getState().drawSegments(
        [],
        [
          [
            [0.6, -1, 0],
            [0.6, 2, 0],
          ],
        ],
      )
    ).status,
  ).toBe("applied");
  const m = Object.values(
    (useEditor.getState().project as ProjectV2).geometries,
  )[0];
  expect(Object.keys(m.edges)).toHaveLength(15);
  expect(Object.keys(m.vertices)).toHaveLength(16);
  const intersection = Object.values(m.vertices).find(
    (v) =>
      Math.abs(v.position[0] - 0.6) < 1e-8 &&
      v.position[1] > 0 &&
      v.position[1] < 1,
  )!;
  expect(
    Object.values(m.edges).filter(
      (e) => e.start === intersection.id || e.end === intersection.id,
    ),
  ).toHaveLength(4);
  useEditor.getState().undo();
  expect(useEditor.getState().project).toEqual(before);
});
it("rejects an arc edit through a locked shared component without changing history or dirty state", async () => {
  const p = componentProject();
  p.nodes["instance/one"].locked = true;
  useEditor.getState().replace(p);
  const before = useEditor.getState();
  const result = await before.drawSegments(
    ["instance/two"],
    arcProfile([0, 0, 0], [2, 0, 0], [1, 0, 1], workPlane("XZ")).segments,
    false,
    () => true,
    true,
  );
  expect(result.status).toBe("rejected");
  expect(useEditor.getState().project).toBe(before.project);
  expect(useEditor.getState().revision).toBe(before.revision);
  expect(useEditor.getState().canUndo).toBe(false);
  expect(useEditor.getState().canRedo).toBe(false);
  expect(isDirty()).toBe(false);
});
