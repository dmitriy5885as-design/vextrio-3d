import { it, expect } from "vitest";
import { useEditor } from "@forma/editor";
import {
  emptyProjectV2,
  geometryContext,
  parseProject,
  serializeProject,
  type ProjectV2,
} from "@forma/document";
import {
  bodyVolume,
  classifyBody,
  extrusionStop,
  tessellateFace,
  type Vec3,
  geometryFromPolygons,
  id,
} from "@forma/geometry";
import { oppositePatch } from "../packages/geometry/src/opposite-patch";
const state = () => {
  const p = useEditor.getState().project as ProjectV2;
  return { p, g: Object.values(p.geometries)[0] };
};
async function draw(points: Vec3[], close = true) {
  const segments: [Vec3, Vec3][] = points
    .slice(0, close ? points.length : -1)
    .map((p, i) => [p, points[(i + 1) % points.length]]);
  expect((await useEditor.getState().drawSegments([], segments)).status).toBe(
    "applied",
  );
}
async function setup(bottom = 1, height = 1, thickness = 0.2) {
  useEditor.getState().replace(emptyProjectV2());
  await draw([
    [0, 0, 0],
    [4, 0, 0],
    [4, 3, 0],
    [0, 3, 0],
  ]);
  let { p, g } = state();
  const cap = Object.values(g.faces)[0];
  const ref = (faceId: string) => ({
    geometryId: g.id,
    definitionId: p.rootDefinitionId,
    entityId: faceId,
    kind: "face" as const,
    occurrencePath: [],
  });
  expect(
    (
      await useEditor.getState().editGeometry(ref(cap.id), {
        kind: "extrude-face",
        faceId: cap.id,
        distance: thickness,
        side: 1,
      })
    ).status,
  ).toBe("applied");
  await draw(
    [
      [1.5, 0, 0],
      [1.5, 3, 0],
    ],
    false,
  );
  await draw([
    [1, bottom, thickness],
    [2, bottom, thickness],
    [2, bottom + height, thickness],
    [1, bottom + height, thickness],
  ]);
  ({ p, g } = state());
  const face = Object.values(g.faces).find((f) => {
    const dto = tessellateFace(g, f);
    return (
      Math.abs(dto.area - height) < 1e-8 &&
      dto.positions.every((v) => Math.abs(v[2] - thickness) < 1e-8)
    );
  })!;
  const body = Object.values(g.bodies).find((b) =>
    b.faceIds.includes(face.id),
  )!;
  const side = g.shells[body.shellIds[0]].faces.find(
    (u) => u.faceId === face.id,
  )!.orientation;
  return { p, g, face, body, side, ref: ref(face.id) };
}
it.each([0.2, -0.2])(
  "cuts across two opposite coplanar faces, thickness %s",
  async (thickness) => {
    const { p, g, face, body, side, ref } = await setup(1, 1, thickness);
    expect(
      extrusionStop(g, face, side, geometryContext(p, g.id))?.distance,
    ).toBeCloseTo(-0.2, 9);
    const result = await useEditor.getState().editGeometry(ref, {
      kind: "extrude-face",
      faceId: face.id,
      distance: -0.2,
      side,
    });
    expect(result.status, JSON.stringify(result)).toBe("applied");
    const after = state();
    expect(classifyBody(after.g, body.id)).toBe("closed-shell");
    expect(bodyVolume(after.g, body.id)).toBeCloseTo(2.2, 9);
    expect(after.g.faces[face.id]).toBeUndefined();
    expect(parseProject(serializeProject(after.p))).toEqual(
      JSON.parse(JSON.stringify(after.p)),
    );
    useEditor.getState().undo();
    expect(state().p).toEqual(p);
    useEditor.getState().redo();
    expect(state().p).toEqual(after.p);
  },
);
it("finishes a floor recess through a divided opposite wall", async () => {
  const { g, face, body, side, ref } = await setup(0, 2);
  expect(
    (
      await useEditor.getState().editGeometry(ref, {
        kind: "extrude-face",
        faceId: face.id,
        distance: -0.05,
        side,
      })
    ).status,
  ).toBe("applied");
  expect(bodyVolume(state().g, body.id)).toBeCloseTo(2.3, 9);
  const result = await useEditor.getState().editGeometry(ref, {
    kind: "extrude-face",
    faceId: face.id,
    distance: -0.15,
    side,
  });
  expect(result.status, JSON.stringify(result)).toBe("applied");
  expect(bodyVolume(state().g, body.id)).toBeCloseTo(2, 9);
  expect(state().g.faces[face.id]).toBeUndefined();
  expect(g.faces[face.id]).toBeDefined();
});

it("cuts through a grid and completely consumes opposite cells inside the opening", async () => {
  const { face, body, side, ref } = await setup();
  for (const x of [1.25, 1.75])
    await draw(
      [
        [x, 0, 0],
        [x, 3, 0],
      ],
      false,
    );
  for (const y of [1.25, 1.75])
    await draw(
      [
        [0, y, 0],
        [4, y, 0],
      ],
      false,
    );
  const before = state().p;
  const result = await useEditor.getState().editGeometry(ref, {
    kind: "extrude-face",
    faceId: face.id,
    distance: -0.2,
    side,
  });
  expect(result.status, JSON.stringify(result)).toBe("applied");
  expect(classifyBody(state().g, body.id)).toBe("closed-shell");
  expect(bodyVolume(state().g, body.id)).toBeCloseTo(2.2, 9);
  useEditor.getState().undo();
  expect(state().p).toEqual(before);
});

it("preserves each opposite region's face ID and different material outside the cut", async () => {
  const { face, side, ref } = await setup();
  const back = Object.values(state().g.faces).filter((f) =>
    tessellateFace(state().g, f).positions.every((p) => Math.abs(p[2]) < 1e-8),
  );
  expect(back).toHaveLength(2);
  for (let i = 0; i < back.length; i++)
    expect(
      useEditor
        .getState()
        .setFaceColor(
          { ...ref, entityId: back[i].id },
          i ? "#cc8844" : "#4488cc",
        ).status,
    ).toBe("applied");
  const before = state().g;
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
  for (const f of back) {
    expect(state().g.faces[f.id].frontMaterialId).toBe(
      before.faces[f.id].frontMaterialId,
    );
    expect(state().g.faces[f.id].backMaterialId).toBe(
      before.faces[f.id].backMaterialId,
    );
  }
});

it("uses physical depth in a rotated nonuniform group", async () => {
  const { face, body, side, ref } = await setup();
  useEditor.getState().selectEntity(ref);
  expect(useEditor.getState().groupScene().status).toBe("applied");
  const node = Object.values(state().p.nodes)[0];
  expect(
    useEditor.getState().patchNode(node.id, {
      transform: {
        translation: [8, 1, 0],
        rotation: [0, Math.sin(0.2), 0, Math.cos(0.2)],
        scale: [2, 3, 0.5],
      },
    }).status,
  ).toBe("applied");
  const { p, g } = state(),
    ctx = geometryContext(p, g.id, true, [node.id]);
  const grouped = {
    ...ref,
    definitionId: g.ownerDefinitionId,
    occurrencePath: [node.id],
  };
  expect(extrusionStop(g, g.faces[face.id], side, ctx)?.distance).toBeCloseTo(
    -0.1,
    9,
  );
  const result = await useEditor.getState().editGeometry(grouped, {
    kind: "extrude-face",
    faceId: face.id,
    distance: -0.1,
    side,
  });
  expect(result.status, JSON.stringify(result)).toBe("applied");
  expect(bodyVolume(state().g, body.id, ctx.worldTransform)).toBeCloseTo(
    6.6,
    8,
  );
});

it("rejects excess depth atomically even when the opposite skin is divided", async () => {
  const { face, side, ref } = await setup(),
    before = useEditor.getState();
  expect(
    (
      await useEditor.getState().editGeometry(ref, {
        kind: "extrude-face",
        faceId: face.id,
        distance: -0.21,
        side,
      })
    ).status,
  ).toBe("rejected");
  expect(useEditor.getState().project).toBe(before.project);
  expect(useEditor.getState().revision).toBe(before.revision);
});

it("never treats a hole inside a coplanar patch as wall material", () => {
  const g = geometryFromPolygons(
    {
      positions: [
        [0, 0, 0],
        [4, 0, 0],
        [4, 4, 0],
        [0, 4, 0],
        [1, 1, 0],
        [3, 1, 0],
        [3, 3, 0],
        [1, 3, 0],
      ],
      polygons: [
        [0, 1, 5, 4],
        [1, 2, 6, 5],
        [2, 3, 7, 6],
        [3, 0, 4, 7],
      ],
    },
    "hole-patch",
    id("owner"),
    id("material"),
  );
  const faces = Object.keys(g.faces),
    context = {
      ownerDefinitionId: "owner",
      materialIds: new Set(["material"]),
    };
  expect(
    oppositePatch(
      g,
      faces[0],
      faces,
      [
        [0.5, 0.5, 0],
        [3.5, 0.5, 0],
        [3.5, 3.5, 0],
        [0.5, 3.5, 0],
      ],
      context,
      false,
    ),
  ).toBeNull();
  expect(
    oppositePatch(
      g,
      faces[0],
      faces,
      [
        [0.1, 1.5, 0],
        [0.9, 1.5, 0],
        [0.9, 2.5, 0],
        [0.1, 2.5, 0],
      ],
      context,
      false,
    ),
  ).toHaveLength(4);
});
