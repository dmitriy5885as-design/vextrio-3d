import { it, expect } from "vitest";
import { useEditor } from "@forma/editor";
import {
  emptyProjectV2,
  geometryContext,
  validateProject,
  serializeProject,
  parseProject,
  occurrenceMatrix,
  type ProjectV2,
} from "@forma/document";
import {
  extrusionStop,
  tessellateFace,
  bodyVolume,
  classifyBody,
} from "@forma/geometry";
async function windowPatch(thickness = 0.2) {
  useEditor.getState().replace(emptyProjectV2());
  const draw = async (r: [number, number, number][]) =>
    useEditor.getState().drawSegments(
      [],
      r.map((a, i) => [a, r[(i + 1) % r.length]]),
    );
  await draw([
    [0, 0, 0],
    [4, 0, 0],
    [4, 3, 0],
    [0, 3, 0],
  ]);
  let p = useEditor.getState().project as ProjectV2,
    g = Object.values(p.geometries)[0],
    face = Object.values(g.faces)[0],
    ref = {
      definitionId: p.rootDefinitionId,
      geometryId: g.id,
      entityId: face.id,
      kind: "face" as const,
      occurrencePath: [],
    };
  expect(
    (
      await useEditor.getState().editGeometry(ref, {
        kind: "extrude-face",
        faceId: face.id,
        distance: thickness,
        side: 1,
      })
    ).status,
  ).toBe("applied");
  expect(
    (
      await draw([
        [1, 1, thickness],
        [2, 1, thickness],
        [2, 2, thickness],
        [1, 2, thickness],
      ])
    ).status,
  ).toBe("applied");
  p = useEditor.getState().project as ProjectV2;
  g = p.geometries[g.id];
  face = Object.values(g.faces).find(
    (f) =>
      Math.abs(f.plane.origin[2] - thickness) < 1e-8 &&
      Math.abs(tessellateFace(g, f).area - 1) < 1e-8,
  )!;
  ref = { ...ref, entityId: face.id };
  const body = Object.values(g.bodies)[0],
    side = g.shells[body.shellIds[0]].faces.find(
      (u) => u.faceId === face.id,
    )!.orientation;
  return { p, g, face, ref, body, side };
}
it.each([0.2, -0.2])(
  "cuts a real closed tunnel through either side of a 200 mm wall: %s",
  async (thickness) => {
    const { p, g, face, ref, body, side } = await windowPatch(thickness),
      limit = extrusionStop(g, face, side, geometryContext(p, g.id));
    expect(limit?.distance).toBeCloseTo(-0.2, 9);
    const r = await useEditor.getState().editGeometry(ref, {
      kind: "extrude-face",
      faceId: face.id,
      distance: -0.2,
      side,
    });
    expect(r.status, JSON.stringify(r)).toBe("applied");
    const after = useEditor.getState().project as ProjectV2,
      m = after.geometries[g.id];
    validateProject(after);
    expect(m.faces[face.id]).toBeUndefined();
    expect(classifyBody(m, body.id)).toBe("closed-shell");
    expect(bodyVolume(m, body.id)).toBeCloseTo(2.2, 9);
    expect(
      Object.values(m.faces).filter((f) => f.innerLoopIds.length),
    ).toHaveLength(2);
    expect(parseProject(serializeProject(after))).toEqual(
      JSON.parse(JSON.stringify(after)),
    );
    useEditor.getState().undo();
    expect(useEditor.getState().project).toEqual(p);
    useEditor.getState().redo();
    expect(useEditor.getState().project).toEqual(after);
  },
);
it("uses physical depth under a scaled and rotated group without losing its occurrence", async () => {
  const { ref, face, side, body } = await windowPatch();
  useEditor.getState().selectEntity(ref);
  expect(useEditor.getState().groupScene().status).toBe("applied");
  let p = useEditor.getState().project as ProjectV2,
    selected = useEditor.getState().topologySelection!,
    node = p.nodes[selected.occurrencePath[0]];
  if (node.kind === "legacy-primitive") throw Error("fixture");
  const transform = structuredClone(node.transform);
  transform.scale = [2, 3, 4];
  transform.rotation = [0, Math.sin(0.3), 0, Math.cos(0.3)];
  useEditor.getState().patchNode(node.id, { transform });
  p = useEditor.getState().project as ProjectV2;
  const g = p.geometries[ref.geometryId],
    limit = extrusionStop(
      g,
      g.faces[face.id],
      side,
      geometryContext(p, g.id, true, selected.occurrencePath),
    );
  expect(limit?.distance).toBeCloseTo(-0.8, 9);
  expect(
    (
      await useEditor
        .getState()
        .editGeometry(selected, {
          kind: "extrude-face",
          faceId: face.id,
          distance: -0.8,
          side,
        })
    ).status,
  ).toBe("applied");
  const after = useEditor.getState().project as ProjectV2;
  expect(
    bodyVolume(
      after.geometries[g.id],
      body.id,
      occurrenceMatrix(after, selected.occurrencePath),
    ),
  ).toBeCloseTo(52.8, 8);
  expect(after.nodes[node.id].transform).toEqual(transform);
});
it("rejects overshooting the opposite wall and preserves document/history", async () => {
  const { p, face, ref, side } = await windowPatch(),
    revision = useEditor.getState().revision;
  expect(
    (
      await useEditor.getState().editGeometry(ref, {
        kind: "extrude-face",
        faceId: face.id,
        distance: -0.3,
        side,
      })
    ).status,
  ).toBe("rejected");
  expect(useEditor.getState().project).toBe(p);
  expect(useEditor.getState().revision).toBe(revision);
});
it("cuts a second separate window without filling the first opening", async () => {
  const { ref, face, side, body } = await windowPatch();
  await useEditor
    .getState()
    .editGeometry(ref, {
      kind: "extrude-face",
      faceId: face.id,
      distance: -0.2,
      side,
    });
  const ring: [number, number, number][] = [
    [2.5, 1, 0.2],
    [3.1, 1, 0.2],
    [3.1, 1.6, 0.2],
    [2.5, 1.6, 0.2],
  ];
  expect(
    (
      await useEditor.getState().drawSegments(
        [],
        ring.map((a, i) => [a, ring[(i + 1) % ring.length]]),
      )
    ).status,
  ).toBe("applied");
  const p = useEditor.getState().project as ProjectV2,
    g = p.geometries[ref.geometryId],
    f = Object.values(g.faces).find(
      (f) =>
        Math.abs(f.plane.origin[2] - 0.2) < 1e-8 &&
        Math.abs(tessellateFace(g, f).area - 0.36) < 1e-8,
    )!;
  expect(f).toBeDefined();
  const orient = g.shells[body.shellIds[0]].faces.find(
    (u) => u.faceId === f.id,
  )!.orientation;
  expect(
    (
      await useEditor
        .getState()
        .editGeometry(
          { ...ref, entityId: f.id },
          { kind: "extrude-face", faceId: f.id, distance: -0.2, side: orient },
        )
    ).status,
  ).toBe("applied");
  const after = useEditor.getState().project as ProjectV2,
    m = after.geometries[g.id];
  expect(classifyBody(m, body.id)).toBe("closed-shell");
  expect(bodyVolume(m, body.id)).toBeCloseTo(2.128, 9);
  expect(
    Object.values(m.faces).filter((f) => f.innerLoopIds.length === 2),
  ).toHaveLength(2);
});
it("retired face references roundtrip and undo restores the referenced face exactly", async () => {
  const { p, ref, face, side } = await windowPatch(),
    candidate = structuredClone(p);
  candidate.references["reference/window"] = {
    id: "reference/window",
    target: structuredClone(ref),
  };
  useEditor.getState().replace(candidate);
  expect(
    (
      await useEditor.getState().editGeometry(ref, {
        kind: "extrude-face",
        faceId: face.id,
        distance: -0.2,
        side,
      })
    ).status,
  ).toBe("applied");
  const after = useEditor.getState().project as ProjectV2;
  validateProject(after);
  expect(parseProject(serializeProject(after))).toEqual(
    JSON.parse(JSON.stringify(after)),
  );
  expect(
    after.provenance.some(
      (l) => l.retiredId === face.id && l.reason === "delete",
    ),
  ).toBe(true);
  useEditor.getState().undo();
  expect(useEditor.getState().project).toEqual(candidate);
});
it("a stale through-cut response cannot overwrite a newer document/history", async () => {
  const { p, ref, face, side } = await windowPatch();
  const operation = useEditor.getState().editGeometry(ref, {
    kind: "extrude-face",
    faceId: face.id,
    distance: -0.2,
    side,
  });
  useEditor.getState().mutate("units", (p) => {
    p.units = "mm";
  });
  expect((await operation).status).toBe("rejected");
  const after = useEditor.getState().project as ProjectV2;
  expect(after.geometries).toEqual(p.geometries);
  expect(after.units).toBe("mm");
  useEditor.getState().undo();
  expect(useEditor.getState().project).toEqual(p);
});
