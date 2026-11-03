import { expect, it } from "vitest";
import { useEditor } from "@forma/editor";
import {
  type ProjectV2,
  parseProject,
  serializeProject,
  geometryContext,
  emptyProjectV2,
} from "@forma/document";
import {
  classifyBody,
  bodyVolume,
  tessellateFace,
  type Vec3,
  geometryFromPolygons,
  id,
  entityTables,
  transformAffine,
} from "@forma/geometry";
import { solidWallProject, boxPolygons } from "./fixtures/solid-walls";
function setup(min?: Vec3, max?: Vec3) {
  const p = solidWallProject(min, max),
    g = Object.values(p.geometries)[0];
  useEditor.getState().replace(p);
  const source = Object.values(g.bodies).find(
    (b) =>
      Math.max(...b.vertexIds.map((v) => g.vertices[v].position[0])) -
        Math.min(...b.vertexIds.map((v) => g.vertices[v].position[0])) <
      0.3,
  )!;
  const ref = {
    geometryId: g.id,
    definitionId: g.ownerDefinitionId,
    kind: "face" as const,
    entityId: source.faceIds[0],
    occurrencePath: [],
  };
  return { p: useEditor.getState().project, g, source, ref };
}
const current = () => {
  const p = useEditor.getState().project as ProjectV2;
  return { p, g: Object.values(p.geometries)[0] };
};
it("joins a translated 200mm partition end to a 200mm wall as one closed 3.6m³ body", async () => {
  const { p, g, source, ref } = setup();
  const result = await useEditor.getState().editGeometry(ref, {
    kind: "translate-entities",
    entities: source.faceIds.map((id) => ({ kind: "face" as const, id })),
    delta: [0, 0, -0.8],
    copy: false,
  });
  expect(result.status, JSON.stringify(result)).toBe("applied");
  const after = current(),
    b = Object.values(after.g.bodies)[0];
  expect(Object.keys(after.g.bodies)).toHaveLength(1);
  expect(classifyBody(after.g, b.id)).toBe("closed-shell");
  expect(bodyVolume(after.g, b.id)).toBeCloseTo(3.6, 8);
  expect(
    Object.values(after.g.faces).reduce(
      (n, f) => n + tessellateFace(after.g, f).area,
      0,
    ),
  ).toBeCloseTo(39.6, 8);
  expect(
    Object.values(after.g.edges).every(
      (e) =>
        Object.values(after.g.coedges).filter((c) => c.edgeId === e.id)
          .length === 2,
    ),
  ).toBe(true);
  expect(parseProject(serializeProject(after.p))).toEqual(
    JSON.parse(JSON.stringify(after.p)),
  );
  useEditor.getState().undo();
  expect(useEditor.getState().project).toEqual(p);
  useEditor.getState().redo();
  expect(useEditor.getState().project).toEqual(after.p);
  expect(Object.keys(g.bodies)).toHaveLength(2);
});

it("joins from the reverse side of the stationary wall", async () => {
  const { source, ref } = setup([1.9, 0, -3], [2.1, 3, -1]);
  const result = await useEditor.getState().editGeometry(ref, {
    kind: "translate-entities",
    entities: source.faceIds.map((id) => ({ kind: "face" as const, id })),
    delta: [0, 0, 1],
    copy: false,
  });
  expect(result.status, JSON.stringify(result)).toBe("applied");
  const g = current().g,
    b = Object.values(g.bodies)[0];
  expect(classifyBody(g, b.id)).toBe("closed-shell");
  expect(bodyVolume(g, b.id)).toBeCloseTo(3.6, 8);
});

it("joins a smaller complete end in the interior of the stationary face", async () => {
  const { source, ref } = setup([1.9, 0.5, 1], [2.1, 2.5, 3]);
  const result = await useEditor.getState().editGeometry(ref, {
    kind: "translate-entities",
    entities: source.faceIds.map((id) => ({ kind: "face" as const, id })),
    delta: [0, 0, -0.8],
    copy: false,
  });
  expect(result.status, JSON.stringify(result)).toBe("applied");
  const g = current().g,
    b = Object.values(g.bodies)[0];
  expect(classifyBody(g, b.id)).toBe("closed-shell");
  expect(bodyVolume(g, b.id)).toBeCloseTo(3.2, 8);
});

it("keeps a physical gap as two closed bodies", async () => {
  const { source, ref } = setup();
  expect(
    (
      await useEditor.getState().editGeometry(ref, {
        kind: "translate-entities",
        entities: source.faceIds.map((id) => ({ kind: "face" as const, id })),
        delta: [0, 0, -0.7],
        copy: false,
      })
    ).status,
  ).toBe("applied");
  expect(Object.keys(current().g.bodies)).toHaveLength(2);
  for (const b of Object.values(current().g.bodies))
    expect(classifyBody(current().g, b.id)).toBe("closed-shell");
});

it("rejects penetration atomically and preserves redo", async () => {
  const { source, ref } = setup();
  useEditor.getState().mutate("name", (p) => {
    p.name = "rename";
  });
  useEditor.getState().undo();
  const before = useEditor.getState();
  expect(before.canRedo).toBe(true);
  expect(
    (
      await useEditor.getState().editGeometry(ref, {
        kind: "translate-entities",
        entities: source.faceIds.map((id) => ({ kind: "face" as const, id })),
        delta: [0, 0, -0.9],
        copy: false,
      })
    ).status,
  ).toBe("rejected");
  expect(useEditor.getState().project).toBe(before.project);
  expect(useEditor.getState().revision).toBe(before.revision);
  expect(useEditor.getState().canRedo).toBe(true);
});

it("rejects a partly overhanging end before changing the model", async () => {
  const { source, ref } = setup([3.9, 0, 1], [4.1, 3, 3]),
    before = useEditor.getState();
  expect(
    (
      await useEditor.getState().editGeometry(ref, {
        kind: "translate-entities",
        entities: source.faceIds.map((id) => ({ kind: "face" as const, id })),
        delta: [0, 0, -0.8],
        copy: false,
      })
    ).status,
  ).toBe("rejected");
  expect(useEditor.getState().project).toBe(before.project);
});

it("preserves different exterior wall and partition materials", async () => {
  const { source, ref } = setup();
  for (const fid of source.faceIds)
    expect(
      useEditor.getState().setFaceColor({ ...ref, entityId: fid }, "#cc8844")
        .status,
    ).toBe("applied");
  const before = current().g;
  expect(
    (
      await useEditor.getState().editGeometry(ref, {
        kind: "translate-entities",
        entities: source.faceIds.map((id) => ({ kind: "face" as const, id })),
        delta: [0, 0, -0.8],
        copy: false,
      })
    ).status,
  ).toBe("applied");
  for (const f of Object.values(current().g.faces))
    if (before.faces[f.id]) {
      expect(f.frontMaterialId).toBe(before.faces[f.id].frontMaterialId);
      expect(f.backMaterialId).toBe(before.faces[f.id].backMaterialId);
    }
});

it("joins inside a rotated nonuniform group with the correct physical volume", async () => {
  const { source, ref } = setup();
  useEditor.getState().selectEntity(ref);
  expect(useEditor.getState().groupScene().status).toBe("applied");
  const node = Object.values(current().p.nodes)[0];
  expect(
    useEditor.getState().patchNode(node.id, {
      transform: {
        translation: [8, 1, 0],
        rotation: [0, Math.sin(0.2), 0, Math.cos(0.2)],
        scale: [2, 3, 0.5],
      },
    }).status,
  ).toBe("applied");
  const { p, g } = current(),
    ctx = geometryContext(p, g.id, true, [node.id]);
  const a = transformAffine([0, 0, -0.8], ctx.worldTransform!),
    b = transformAffine([0, 0, 0], ctx.worldTransform!);
  const delta = a.map((n, i) => n - b[i]) as Vec3;
  const result = await useEditor.getState().editGeometry(
    { ...ref, definitionId: g.ownerDefinitionId, occurrencePath: [node.id] },
    {
      kind: "translate-entities",
      entities: source.faceIds.map((id) => ({ kind: "face" as const, id })),
      delta,
      copy: false,
    },
  );
  expect(result.status, JSON.stringify(result)).toBe("applied");
  expect(
    bodyVolume(
      current().g,
      Object.keys(current().g.bodies)[0],
      ctx.worldTransform,
    ),
  ).toBeCloseTo(10.8, 8);
  expect(current().p.nodes).toEqual(p.nodes);
});

it("leaves a distant independent body and every one of its entities unchanged", async () => {
  const { source, ref } = setup(),
    p = structuredClone(current().p),
    g = Object.values(p.geometries)[0];
  const extra = geometryFromPolygons(
    boxPolygons([10, 0, 0], [11, 1, 1]),
    "unrelated-box",
    g.ownerDefinitionId,
    id(Object.keys(p.materials)[0]),
  );
  for (const table of entityTables) Object.assign(g[table], extra[table]);
  useEditor.getState().replace(p);
  expect(
    (
      await useEditor.getState().editGeometry(ref, {
        kind: "translate-entities",
        entities: source.faceIds.map((id) => ({ kind: "face" as const, id })),
        delta: [0, 0, -0.8],
        copy: false,
      })
    ).status,
  ).toBe("applied");
  expect(Object.keys(current().g.bodies)).toHaveLength(2);
  for (const table of entityTables)
    for (const key of Object.keys(extra[table]))
      expect(current().g[table][key]).toEqual(extra[table][key]);
});

it("joins walls built by native Sketch and extrusion with explicit shell orientations", async () => {
  expect(useEditor.getState().replace(emptyProjectV2()).status).toBe("applied");
  async function solid(ring: Vec3[]) {
    expect(
      (
        await useEditor.getState().drawSegments(
          [],
          ring.map((a, i) => [a, ring[(i + 1) % 4]]),
        )
      ).status,
    ).toBe("applied");
    const { g } = current(),
      face = Object.values(g.faces).find(
        (f) =>
          tessellateFace(g, f).positions.every((v) => Math.abs(v[1]) < 1e-8) &&
          g.bodies[
            Object.keys(g.bodies).find((b) =>
              g.bodies[b].faceIds.includes(f.id),
            )!
          ].faceIds.length === 1,
      )!;
    const ref = {
      geometryId: g.id,
      definitionId: g.ownerDefinitionId,
      entityId: face.id,
      kind: "face" as const,
      occurrencePath: [],
    };
    // XZ drawing is clockwise as viewed from +Y, so its initial normal is -Y.
    const distance = face.plane.normal[1] > 0 ? 3 : -3;
    expect(
      (
        await useEditor.getState().editGeometry(ref, {
          kind: "extrude-face",
          faceId: face.id,
          distance,
          side: 1,
        })
      ).status,
    ).toBe("applied");
  }
  await solid([
    [0, 0, 0],
    [4, 0, 0],
    [4, 0, 0.2],
    [0, 0, 0.2],
  ]);
  await solid([
    [1.9, 0, 1],
    [2.1, 0, 1],
    [2.1, 0, 3],
    [1.9, 0, 3],
  ]);
  const { g } = current(),
    source = Object.values(g.bodies).find((b) =>
      b.vertexIds.every((v) => g.vertices[v].position[2] >= 1),
    )!;
  expect(source.shellIds).toHaveLength(1);
  const result = await useEditor.getState().editGeometry(
    {
      geometryId: g.id,
      definitionId: g.ownerDefinitionId,
      entityId: source.faceIds[0],
      kind: "face",
      occurrencePath: [],
    },
    {
      kind: "translate-entities",
      entities: source.faceIds.map((id) => ({ kind: "face" as const, id })),
      delta: [0, 0, -0.8],
      copy: false,
    },
  );
  expect(result.status, JSON.stringify(result)).toBe("applied");
  const b = Object.values(current().g.bodies)[0];
  expect(classifyBody(current().g, b.id)).toBe("closed-shell");
  expect(bodyVolume(current().g, b.id)).toBeCloseTo(3.6, 8);
  const shellMerge = current().p.provenance.filter(
    (l) => l.kind === "shell" && l.reason === "merge",
  );
  expect(shellMerge).toHaveLength(2);
  for (const entry of shellMerge)
    expect(entry.descendants.map((d) => d.id)).toEqual(b.shellIds);
});
it("can extend only the partition end face to the wall and remove the interior interface", async () => {
  const { g, source, ref } = setup();
  const cap = source.faceIds
    .map((fid) => g.faces[fid])
    .find((f) =>
      tessellateFace(g, f).positions.every((v) => Math.abs(v[2] - 1) < 1e-8),
    )!;
  const result = await useEditor.getState().editGeometry(
    { ...ref, entityId: cap.id },
    {
      kind: "translate-entities",
      entities: [{ kind: "face", id: cap.id }],
      delta: [0, 0, -0.8],
      copy: false,
    },
  );
  expect(result.status, JSON.stringify(result)).toBe("applied");
  const b = Object.values(current().g.bodies)[0];
  expect(Object.keys(current().g.bodies)).toHaveLength(1);
  expect(classifyBody(current().g, b.id)).toBe("closed-shell");
  expect(bodyVolume(current().g, b.id)).toBeCloseTo(4.08, 8);
});
