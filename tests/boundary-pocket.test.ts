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
  bodyVolume,
  classifyBody,
  tessellateFace,
  validateGeometry,
  type Vec3,
} from "@forma/geometry";
const state = () => {
  const p = useEditor.getState().project as ProjectV2;
  return { p, g: Object.values(p.geometries)[0] };
};
async function draw(points: Vec3[]) {
  expect(
    (
      await useEditor.getState().drawSegments(
        [],
        points.map((p, i) => [p, points[(i + 1) % points.length]]),
      )
    ).status,
  ).toBe("applied");
}
async function extrude(fid: string, distance: number, path: string[] = []) {
  const { g } = state();
  return useEditor.getState().editGeometry(
    {
      definitionId: g.ownerDefinitionId,
      geometryId: g.id,
      kind: "face",
      entityId: fid,
      occurrencePath: path,
    },
    { kind: "extrude-face", faceId: fid, distance, side: 1 },
  );
}
async function setup(
  points: Vec3[] = [
    [1, 0, 0.2],
    [1.8, 0, 0.2],
    [1.8, 2, 0.2],
    [1, 2, 0.2],
  ],
) {
  await draw([
    [0, 0, 0],
    [4, 0, 0],
    [4, 0, 0.2],
    [0, 0, 0.2],
  ]);
  expect((await extrude(Object.keys(state().g.faces)[0], 3)).status).toBe(
    "applied",
  );
  await draw(points);
  const { g } = state();
  return Object.values(g.faces).find(
    (f) =>
      tessellateFace(g, f).positions.every(
        (p) => Math.abs(p[2] - points[0][2]) < 1e-8,
      ) && Math.abs(tessellateFace(g, f).area - 1.6) < 1e-8,
  )!.id;
}
function volume(expected: number) {
  const { p, g } = state();
  validateGeometry(g, geometryContext(p, g.id));
  const bid = Object.keys(g.bodies)[0];
  expect(classifyBody(g, bid)).toBe("closed-shell");
  expect(bodyVolume(g, bid)).toBeCloseTo(expected, 8);
}
beforeEach(() => {
  useEditor.getState().replace(emptyProjectV2());
  usePrecision
    .getState()
    .configure({ enabled: false, path: [], planeName: "XZ", system: "world" });
});
it("cuts a 50mm floor-touching recess without opening the opposite wall and restores exact IDs", async () => {
  const fid = await setup(),
    before = state().p;
  const result = await extrude(fid, -0.05);
  expect(result.status).toBe("applied");
  volume(2.32);
  const after = state();
  expect(after.g.faces[fid]).toBeDefined();
  expect(
    tessellateFace(after.g, after.g.faces[fid]).positions.every(
      (p) => Math.abs(p[2] - 0.15) < 1e-8,
    ),
  ).toBe(true);
  expect(serializeProject(parseProject(serializeProject(after.p)))).toBe(
    serializeProject(after.p),
  );
  useEditor.getState().undo();
  expect(state().p).toEqual(before);
  useEditor.getState().redo();
  expect(state().p).toEqual(after.p);
});
it("can finish the recess into a through doorway without leaving its back cap", async () => {
  const fid = await setup();
  expect((await extrude(fid, -0.05)).status).toBe("applied");
  volume(2.32);
  const before = state().p;
  expect((await extrude(fid, -0.15)).status).toBe("applied");
  volume(2.08);
  expect(state().g.faces[fid]).toBeUndefined();
  useEditor.getState().undo();
  expect(state().p).toEqual(before);
});
it("rejects a recess deeper than the wall atomically", async () => {
  const fid = await setup(),
    before = useEditor.getState();
  expect((await extrude(fid, -0.21)).status).toBe("rejected");
  const after = useEditor.getState();
  expect(after.project).toBe(before.project);
  expect(after.revision).toBe(before.revision);
  expect(after.savedSignature).toBe(before.savedSignature);
  expect(after.canUndo).toBe(before.canUndo);
  expect(after.canRedo).toBe(before.canRedo);
});
it("cuts a notch touching two outer boundaries with a closed shell", async () => {
  const fid = await setup([
    [0, 0, 0.2],
    [0.8, 0, 0.2],
    [0.8, 2, 0.2],
    [0, 2, 0.2],
  ]);
  expect((await extrude(fid, -0.05)).status).toBe("applied");
  volume(2.32);
});
it("uses world distance in a rotated nonuniform group and preserves the other context", async () => {
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
  const before = state().p;
  expect((await extrude(fid, -0.025, [node.id])).status).toBe("applied");
  ({ p, g } = state());
  const ctx = geometryContext(p, g.id, true, [node.id]);
  expect(
    bodyVolume(g, Object.keys(g.bodies)[0], ctx.worldTransform),
  ).toBeCloseTo(6.96, 8);
  expect(p.nodes).toEqual(before.nodes);
});

it("completes an interior pocket into a through window on the second Push/Pull", async () => {
  const fid = await setup([
    [1, 0.5, 0.2],
    [1.8, 0.5, 0.2],
    [1.8, 2.5, 0.2],
    [1, 2.5, 0.2],
  ]);
  expect((await extrude(fid, -0.05)).status).toBe("applied");
  volume(2.32);
  expect((await extrude(fid, -0.15)).status).toBe("applied");
  volume(2.08);
  expect(state().g.faces[fid]).toBeUndefined();
});
it("cuts from the back skin with its outward orientation", async () => {
  const fid = await setup([
    [1, 0, 0],
    [1.8, 0, 0],
    [1.8, 2, 0],
    [1, 2, 0],
  ]);
  expect((await extrude(fid, -0.05)).status).toBe("applied");
  volume(2.32);
  expect(
    tessellateFace(state().g, state().g.faces[fid]).positions.every(
      (p) => Math.abs(p[2] - 0.05) < 1e-8,
    ),
  ).toBe(true);
});
it("cuts and deepens a floor recess in a complete wall ring without entering the room void", async () => {
  await draw([
    [0, 0, 0],
    [4, 0, 0],
    [4, 0, 3],
    [0, 0, 3],
  ]);
  let { g } = state();
  let fid = Object.keys(g.faces)[0];
  const ref = (id: string) => ({
    definitionId: g.ownerDefinitionId,
    geometryId: g.id,
    kind: "face" as const,
    entityId: id,
    occurrencePath: [],
  });
  expect(
    (
      await useEditor.getState().editGeometry(ref(fid), {
        kind: "offset-face",
        faceId: fid,
        distance: 0.2,
      })
    ).status,
  ).toBe("applied");
  g = state().g;
  fid = Object.values(g.faces).find((f) => !f.innerLoopIds.length)!.id;
  expect(
    (
      await useEditor
        .getState()
        .editGeometry(ref(fid), { kind: "delete-entities", entityIds: [fid] })
    ).status,
  ).toBe("applied");
  expect((await extrude(Object.keys(state().g.faces)[0], 3)).status).toBe(
    "applied",
  );
  await draw([
    [1, 0, 3],
    [1.8, 0, 3],
    [1.8, 2, 3],
    [1, 2, 3],
  ]);
  g = state().g;
  fid = Object.values(g.faces).find(
    (f) =>
      Math.abs(tessellateFace(g, f).area - 1.6) < 1e-8 &&
      tessellateFace(g, f).positions.every((p) => p[2] === 3),
  )!.id;
  expect((await extrude(fid, -0.05)).status).toBe("applied");
  volume(7.84);
  expect((await extrude(fid, -0.05)).status).toBe("applied");
  volume(7.76);
  expect((await extrude(fid, -0.1)).status).toBe("applied");
  volume(7.6);
});
it.each([0, NaN, Infinity, -1e7])(
  "rejects invalid depth %s without changing document identity",
  async (distance) => {
    const fid = await setup(),
      before = useEditor.getState();
    expect((await extrude(fid, distance)).status).toBe("rejected");
    expect(useEditor.getState().project).toBe(before.project);
    expect(useEditor.getState().revision).toBe(before.revision);
  },
);

it("edits only the chosen independent group and rejects a locked occurrence", async () => {
  const fid = await setup();
  expect(useEditor.getState().groupScene().status).toBe("applied");
  const nid = Object.keys(state().p.nodes)[0];
  expect(useEditor.getState().copyInstance(nid).status).toBe("applied");
  const other = Object.keys(state().p.nodes).find((id) => id !== nid)!;
  expect(useEditor.getState().makeUnique(other).status).toBe("applied");
  const before = state().p;
  const node = before.nodes[other];
  if (node.kind === "legacy-primitive") throw Error("fixture");
  const gid = before.definitions[node.definitionId].geometryId!;
  expect((await extrude(fid, -0.05, [nid])).status).toBe("applied");
  expect(state().p.geometries[gid]).toEqual(before.geometries[gid]);
  expect(state().p.nodes).toEqual(before.nodes);
  expect(useEditor.getState().setNodeLocked(nid, true).status).toBe("applied");
  const locked = useEditor.getState();
  expect((await extrude(fid, -0.05, [nid])).status).toBe("rejected");
  expect(useEditor.getState().project).toBe(locked.project);
  expect(useEditor.getState().revision).toBe(locked.revision);
});
