import { beforeEach, it, expect } from "vitest";
import { useEditor, usePrecision } from "@forma/editor";
import {
  emptyProjectV2,
  geometryContext,
  serializeProject,
  parseProject,
  type ProjectV2,
} from "@forma/document";
import {
  containsRing,
  loopVertices,
  tessellateFace,
  bodyVolume,
  classifyBody,
  extrusionStop,
  type Vec3,
} from "@forma/geometry";
const state = () => {
  const p = useEditor.getState().project as ProjectV2,
    g = Object.values(p.geometries)[0];
  return { p, g };
};
async function draw(points: Vec3[]) {
  expect(
    (
      await useEditor.getState().drawSegments(
        [],
        points.map((a, i) => [a, points[(i + 1) % points.length]]),
      )
    ).status,
  ).toBe("applied");
}
async function edit(
  faceId: string,
  intent: Parameters<ReturnType<typeof useEditor.getState>["editGeometry"]>[1],
  path: string[] = [],
) {
  const { g } = state();
  return useEditor.getState().editGeometry(
    {
      definitionId: g.ownerDefinitionId,
      geometryId: g.id,
      kind: "face",
      entityId: faceId,
      occurrencePath: path,
    },
    intent,
  );
}
async function setup() {
  await draw([
    [0, 0, 0],
    [4, 0, 0],
    [4, 0, 3],
    [0, 0, 3],
  ]);
  let { g } = state(),
    face = Object.values(g.faces)[0];
  expect(
    (
      await edit(face.id, {
        kind: "offset-face",
        faceId: face.id,
        distance: 0.2,
      })
    ).status,
  ).toBe("applied");
  g = state().g;
  const center = Object.values(g.faces).find((f) => !f.innerLoopIds.length)!;
  expect(
    (await edit(center.id, { kind: "delete-entities", entityIds: [center.id] }))
      .status,
  ).toBe("applied");
  g = state().g;
  face = Object.values(g.faces)[0];
  expect(
    (
      await edit(face.id, {
        kind: "extrude-face",
        faceId: face.id,
        distance: 3,
        side: 1,
      })
    ).status,
  ).toBe("applied");
  await draw([
    [1, 1, 3],
    [2, 1, 3],
    [2, 2, 3],
    [1, 2, 3],
  ]);
  g = state().g;
  face = Object.values(g.faces).find(
    (f) =>
      Math.abs(tessellateFace(g, f).area - 1) < 1e-7 &&
      tessellateFace(g, f).positions.every((p) => p[2] === 3),
  )!;
  expect(
    (
      await edit(face.id, {
        kind: "extrude-face",
        faceId: face.id,
        distance: -0.2,
        side: 1,
      })
    ).status,
  ).toBe("applied");
  await draw([
    [2.5, 0, 3],
    [3.3, 0, 3],
    [3.3, 2, 3],
    [2.5, 2, 3],
  ]);
  g = state().g;
  return Object.values(g.faces).find(
    (f) =>
      Math.abs(tessellateFace(g, f).area - 1.6) < 1e-7 &&
      tessellateFace(g, f).positions.every((p) => p[2] === 3),
  )!.id;
}
beforeEach(() => {
  useEditor.getState().replace(emptyProjectV2());
  usePrecision
    .getState()
    .configure({ enabled: false, path: [], planeName: "XZ", system: "world" });
});
it("permits a bottom reveal meeting the room boundary but never the room void itself", async () => {
  await setup();
  const { p, g } = state(),
    bottom = Object.values(g.faces).find(
      (f) =>
        f.innerLoopIds.length &&
        tessellateFace(g, f).positions.every((p) => p[1] === 0),
    )!,
    context = geometryContext(p, g.id);
  const strip: Vec3[] = [
    [2.5, 0, 3],
    [3.3, 0, 3],
    [3.3, 0, 2.8],
    [2.5, 0, 2.8],
  ];
  expect(containsRing(g, bottom, strip, context)).toBe(false);
  expect(containsRing(g, bottom, strip, context, true)).toBe(true);
  const hole = loopVertices(g, bottom.innerLoopIds[0]);
  expect(containsRing(g, bottom, hole, context, true)).toBe(false);
  expect(
    containsRing(
      g,
      bottom,
      [
        [1, 0, 3],
        [2, 0, 3],
        [2, 0, 1],
        [1, 0, 1],
      ],
      context,
      true,
    ),
  ).toBe(false);
});
it("cuts the door after a window in a complete wall ring with 7.4m³ material and exact history", async () => {
  const fid = await setup(),
    before = useEditor.getState().project,
    { p, g } = state(),
    stop = extrusionStop(g, g.faces[fid], 1, geometryContext(p, g.id));
  expect(stop?.distance).toBeCloseTo(-0.2);
  expect(stop?.boundaryEdges).toHaveLength(1);
  expect(
    (
      await edit(fid, {
        kind: "extrude-face",
        faceId: fid,
        distance: -0.2,
        side: 1,
      })
    ).status,
  ).toBe("applied");
  const after = state(),
    bid = Object.keys(after.g.bodies)[0];
  expect(classifyBody(after.g, bid)).toBe("closed-shell");
  expect(bodyVolume(after.g, bid)).toBeCloseTo(7.4, 8);
  expect(
    Object.values(after.g.faces).filter(
      (f) => f.innerLoopIds.length && Math.abs(f.plane.normal[2]) > 0.99,
    ),
  ).toHaveLength(2);
  expect(serializeProject(parseProject(serializeProject(after.p)))).toBe(
    serializeProject(after.p),
  );
  useEditor.getState().undo();
  expect(useEditor.getState().project).toEqual(before);
  useEditor.getState().redo();
  expect(useEditor.getState().project).toEqual(after.p);
});
it("preserves the complete ring, window, dirty state and history on excessive door depth", async () => {
  const fid = await setup(),
    before = useEditor.getState();
  expect(
    (
      await edit(fid, {
        kind: "extrude-face",
        faceId: fid,
        distance: -0.4,
        side: 1,
      })
    ).status,
  ).toBe("rejected");
  expect(useEditor.getState().project).toBe(before.project);
  expect(useEditor.getState().savedSignature).toBe(before.savedSignature);
  expect(useEditor.getState().revision).toBe(before.revision);
  expect(useEditor.getState().canUndo).toBe(before.canUndo);
  expect(useEditor.getState().canRedo).toBe(before.canRedo);
});
it("uses the physical wall thickness inside a rotated nonuniform group", async () => {
  const fid = await setup();
  expect(useEditor.getState().groupScene().status).toBe("applied");
  let { p, g } = state();
  const node = Object.values(p.nodes).find(
    (n) => n.kind !== "legacy-primitive",
  )!;
  expect(
    useEditor.getState().patchNode(node.id, {
      transform: {
        translation: [8, 1, 0],
        rotation: [0, Math.sin(0.2), 0, Math.cos(0.2)],
        scale: [2, 3, 0.5],
      },
    }).status,
  ).toBe("applied");
  p = state().p;
  g = state().g;
  const context = geometryContext(p, g.id, true, [node.id]);
  expect(extrusionStop(g, g.faces[fid], 1, context)?.distance).toBeCloseTo(
    -0.1,
    8,
  );
  expect(
    (
      await edit(
        fid,
        { kind: "extrude-face", faceId: fid, distance: -0.1, side: 1 },
        [node.id],
      )
    ).status,
  ).toBe("applied");
  const after = state();
  expect(
    bodyVolume(after.g, Object.keys(after.g.bodies)[0], context.worldTransform),
  ).toBeCloseTo(22.2, 7);
});
