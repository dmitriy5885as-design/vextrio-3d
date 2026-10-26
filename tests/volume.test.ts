import { it, expect } from "vitest";
import {
  topologyProject,
  firstRef,
  componentProject,
} from "./fixtures/v2-project";
import {
  prepareExtrusion,
  id,
  applyDelta,
  bodyVolume,
  classifyBody,
  canonical,
  validateGeometry,
  tessellateFace,
} from "@forma/geometry";
import {
  geometryContext,
  validateProject,
  serializeProject,
  parseProject,
  occurrenceMatrix,
  type ProjectV2,
  emptyProjectV2,
} from "@forma/document";
import { useEditor } from "@forma/editor";
function extruded(hole = true, height = 3) {
  const p = topologyProject(hole),
    g = Object.values(p.geometries)[0];
  const face =
    Object.values(g.faces).find((f) => f.innerLoopIds.length) ??
    Object.values(g.faces)[0];
  const context = geometryContext(p, g.id),
    change = prepareExtrusion(
      g,
      face.id,
      height,
      1,
      context,
      id("test/extrude"),
    );
  return {
    p,
    g,
    context,
    change,
    face,
    after: applyDelta(g, change.forward, context),
  };
}
it("extrudes a planar face with a hole into a closed genus-one shell with exact net volume", () => {
  const { after, g, change, context } = extruded(true);
  const body = Object.values(after.bodies)[0];
  expect(classifyBody(after, body.id)).toBe("closed-shell");
  expect(bodyVolume(after, body.id)).toBeCloseTo(33, 10);
  expect(Object.keys(after.faces)).toHaveLength(10);
  expect(Object.keys(after.vertices)).toHaveLength(16);
  expect(Object.keys(after.edges)).toHaveLength(24);
  expect(applyDelta(after, change.inverse, context)).toEqual(g);
});
it("extrudes a concave L profile in either direction with the correct physical volume", async () => {
  useEditor.getState().replace(emptyProjectV2());
  const ring: [number, number, number][] = [
    [0, 0, 0],
    [4, 0, 0],
    [4, 1, 0],
    [1, 1, 0],
    [1, 4, 0],
    [0, 4, 0],
  ];
  expect(
    (
      await useEditor.getState().drawSegments(
        [],
        ring.map((v, i) => [v, ring[(i + 1) % ring.length]]),
      )
    ).status,
  ).toBe("applied");
  const p = useEditor.getState().project as ProjectV2,
    g = Object.values(p.geometries)[0],
    face = Object.values(g.faces)[0],
    ctx = geometryContext(p, g.id);
  for (const h of [2, -2]) {
    const change = prepareExtrusion(
        g,
        face.id,
        h,
        1,
        ctx,
        id("concave/" + (h > 0 ? "up" : "down")),
      ),
      after = applyDelta(g, change.forward, ctx);
    expect(bodyVolume(after, Object.keys(after.bodies)[0])).toBeCloseTo(14, 9);
    expect(classifyBody(after, Object.keys(after.bodies)[0])).toBe(
      "closed-shell",
    );
  }
});
it("rejects a real intersection against a different face atomically, preserving redo", async () => {
  useEditor.getState().replace(emptyProjectV2());
  const rings: [number, number, number][][] = [
    [
      [0, 0, 0],
      [4, 0, 0],
      [4, 3, 0],
      [0, 3, 0],
    ],
    [
      [2, -1, 1],
      [2, 4, 1],
      [2, 4, 4],
      [2, -1, 4],
    ],
  ];
  for (const ring of rings)
    expect(
      (
        await useEditor.getState().drawSegments(
          [],
          ring.map((v, i) => [v, ring[(i + 1) % ring.length]]),
        )
      ).status,
    ).toBe("applied");
  const p = useEditor.getState().project as ProjectV2,
    g = Object.values(p.geometries)[0],
    face = Object.values(g.faces).find(
      (f) => Math.abs(f.plane.normal[2]) > 0.9,
    )!;
  const ref = {
    definitionId: p.rootDefinitionId,
    geometryId: g.id,
    kind: "face" as const,
    entityId: face.id,
    occurrencePath: [],
  };
  const revision = useEditor.getState().revision,
    undo = useEditor.getState().canUndo,
    redo = useEditor.getState().canRedo,
    signature = useEditor.getState().savedSignature;
  const result = await useEditor
    .getState()
    .editGeometry(ref, {
      kind: "extrude-face",
      faceId: face.id,
      distance: 3,
      side: 1,
    });
  expect(result.status).toBe("rejected");
  if (result.status === "rejected")
    expect(result.error).toContain("пересекает");
  expect(useEditor.getState().project).toBe(p);
  expect(useEditor.getState().revision).toBe(revision);
  expect(useEditor.getState().canUndo).toBe(undo);
  expect(useEditor.getState().canRedo).toBe(redo);
  expect(useEditor.getState().savedSignature).toBe(signature);
});
it.each([3, -3])(
  "positive/negative extrusion maintains closed orientation and finite volume: %s",
  (height) => {
    const { after } = extruded(true, height),
      body = Object.values(after.bodies)[0];
    expect(classifyBody(after, body.id)).toBe("closed-shell");
    expect(bodyVolume(after, body.id)).toBeCloseTo(33, 9);
  },
);
it("can grow and shrink a prismatic cap without losing its stable IDs", () => {
  const { after, face, context } = extruded(true),
    ids = Object.keys(after.vertices);
  const grow = prepareExtrusion(after, face.id, 1, 1, context, id("test/grow")),
    grown = applyDelta(after, grow.forward, context);
  expect(Object.keys(grown.vertices)).toEqual(ids);
  expect(bodyVolume(grown, Object.keys(grown.bodies)[0])).toBeCloseTo(44, 9);
  const shrink = prepareExtrusion(
      grown,
      face.id,
      -2,
      1,
      context,
      id("test/shrink"),
    ),
    shrunk = applyDelta(grown, shrink.forward, context);
  expect(bodyVolume(shrunk, Object.keys(shrunk.bodies)[0])).toBeCloseTo(22, 9);
  expect(() =>
    prepareExtrusion(shrunk, face.id, -3, 1, context, id("test/invert")),
  ).toThrow();
});
it.each([0, NaN, Infinity, 1e9])(
  "rejects invalid height without mutating the source: %s",
  (distance) => {
    const p = topologyProject(),
      g = Object.values(p.geometries)[0],
      before = canonical(g);
    expect(() =>
      prepareExtrusion(
        g,
        Object.keys(g.faces)[0],
        distance,
        1,
        geometryContext(p, g.id),
        id("test/invalid"),
      ),
    ).toThrow();
    expect(canonical(g)).toBe(before);
  },
);
it("commits through common editor history and roundtrips volume topology/materials/IDs", async () => {
  const p = topologyProject();
  useEditor.getState().replace(p);
  const ref = firstRef(p, "face");
  const result = await useEditor.getState().editGeometry(ref, {
    kind: "extrude-face",
    faceId: ref.entityId,
    distance: 3,
    side: 1,
  });
  expect(result.status).toBe("applied");
  const after = useEditor.getState().project as ProjectV2;
  validateProject(after);
  expect(parseProject(serializeProject(after))).toEqual(
    JSON.parse(JSON.stringify(after)),
  );
  useEditor.getState().undo();
  expect(useEditor.getState().project).toEqual(p);
  useEditor.getState().redo();
  expect(useEditor.getState().project).toEqual(after);
});
it("world-space extrusion distance stays physical inside scaled/sheared occurrences", () => {
  const p = componentProject(),
    n = p.nodes["instance/two"];
  if (n.kind === "legacy-primitive") throw Error("fixture");
  n.transform.scale = [2, 3, 4];
  n.transform.rotation = [0, Math.sin(0.2), 0, Math.cos(0.2)];
  const g = Object.values(p.geometries)[0],
    context = geometryContext(p, g.id, true, [n.id]),
    face = Object.values(g.faces)[0];
  const result = prepareExtrusion(g, face.id, 2, 1, context, id("test/scaled")),
    after = applyDelta(g, result.forward, context),
    body = Object.values(after.bodies)[0];
  expect(bodyVolume(after, body.id, occurrenceMatrix(p, [n.id]))).toBeCloseTo(
    11 * 6 * 2,
    8,
  );
  validateGeometry(after, context);
  expect(p.geometries[g.id]).toBe(g);
});
it("draws a new contour on an existing solid and cuts a real bounded pocket", async () => {
  const p = topologyProject();
  useEditor.getState().replace(p);
  const ref = firstRef(p, "face");
  await useEditor.getState().editGeometry(ref, {
    kind: "extrude-face",
    faceId: ref.entityId,
    distance: 3,
    side: 1,
  });
  const ring: [number, number, number][] = [
    [0.2, 0.2, 3],
    [0.8, 0.2, 3],
    [0.8, 0.8, 3],
    [0.2, 0.8, 3],
  ];
  const draw = await useEditor.getState().drawSegments(
    [],
    ring.map((v, i) => [v, ring[(i + 1) % ring.length]]),
  );
  expect(draw.status, JSON.stringify(draw)).toBe("applied");
  const sheet = useEditor.getState().project as ProjectV2,
    g = sheet.geometries[ref.geometryId],
    body = Object.values(g.bodies)[0];
  expect(classifyBody(g, body.id)).toBe("closed-shell");
  expect(bodyVolume(g, body.id)).toBeCloseTo(33, 8);
  const face = Object.values(g.faces).find(
    (f) =>
      Math.abs(tessellateFace(g, f).area - 0.36) < 1e-8 &&
      Math.abs(f.plane.origin[2] - 3) < 1e-7,
  )!;
  expect(face).toBeDefined();
  const side = g.shells[body.shellIds[0]].faces.find(
    (u) => u.faceId === face.id,
  )!.orientation;
  const result = await useEditor
    .getState()
    .editGeometry(
      { ...ref, entityId: face.id },
      { kind: "extrude-face", faceId: face.id, distance: -1, side },
    );
  expect(result.status).toBe("applied");
  const after = (useEditor.getState().project as ProjectV2).geometries[g.id];
  expect(bodyVolume(after, body.id)).toBeCloseTo(33 - 0.36, 8);
});
