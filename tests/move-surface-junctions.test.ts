import { expect, it } from "vitest";
import { useEditor } from "@forma/editor";
import {
  emptyProjectV2,
  parseProject,
  serializeProject,
  type ProjectV2,
} from "@forma/document";
import {
  geometryFromPolygons,
  id,
  tessellateFace,
  classifyBody,
  bodyVolume,
  transformAffine,
} from "@forma/geometry";
import { geometryContext } from "@forma/document";

function scene() {
  const p = emptyProjectV2(),
    material = "material/junction";
  p.materials[material] = {
    id: material,
    color: "#86b7c6",
    roughness: 0.7,
    metalness: 0,
  };
  const g = geometryFromPolygons(
    {
      positions: [
        [0, 0, 0],
        [4, 0, 0],
        [4, 3, 0],
        [0, 3, 0],
        [2, 0, 1],
        [2, 3, 1],
        [2, 3, 2],
        [2, 0, 2],
      ],
      polygons: [
        [0, 1, 2, 3],
        [4, 5, 6, 7],
      ],
    },
    "junction",
    id(p.rootDefinitionId),
    id(material),
  );
  p.geometries[g.id] = g;
  p.definitions[p.rootDefinitionId].geometryId = g.id;
  useEditor.getState().replace(p);
  const face = Object.values(g.faces).find(
    (f) => Math.abs(f.plane.normal[0]) > 0.9,
  )!;
  return {
    g,
    face,
    ref: {
      definitionId: g.ownerDefinitionId,
      geometryId: g.id,
      entityId: face.id,
      kind: "face" as const,
      occurrencePath: [],
    },
  };
}
function model() {
  const p = useEditor.getState().project as ProjectV2;
  return { p, g: Object.values(p.geometries)[0] };
}
it("moves a partition onto a wall and creates one shared T edge with three incident faces", async () => {
  const { face, ref } = scene(),
    before = useEditor.getState().project;
  const result = await useEditor.getState().editGeometry(ref, {
    kind: "translate-entities",
    entities: [{ kind: "face", id: face.id }],
    delta: [0, 0, -1],
    copy: false,
  });
  expect(result.status, JSON.stringify(result)).toBe("applied");
  const { p, g } = model();
  expect(Object.keys(g.faces)).toHaveLength(3);
  expect(Object.keys(g.bodies)).toHaveLength(1);
  expect(classifyBody(g, Object.keys(g.bodies)[0])).toBe("non-manifold");
  expect(bodyVolume(g, Object.keys(g.bodies)[0])).toBeNull();
  const shared = Object.values(g.edges).filter(
    (e) =>
      Math.abs(g.vertices[e.start].position[0] - 2) < 1e-8 &&
      Math.abs(g.vertices[e.end].position[0] - 2) < 1e-8 &&
      Math.abs(g.vertices[e.start].position[2]) < 1e-8 &&
      Math.abs(g.vertices[e.end].position[2]) < 1e-8,
  );
  expect(shared).toHaveLength(1);
  expect(
    Object.values(g.coedges).filter((c) => c.edgeId === shared[0].id),
  ).toHaveLength(3);
  expect(
    Object.values(g.faces)
      .map((f) => tessellateFace(g, f).area)
      .sort((a, b) => a - b),
  ).toEqual([3, 6, 6]);
  expect(parseProject(serializeProject(p))).toEqual(
    JSON.parse(JSON.stringify(p)),
  );
  useEditor.getState().undo();
  expect(useEditor.getState().project).toEqual(before);
  useEditor.getState().redo();
  expect(useEditor.getState().project).toEqual(p);
});

it("preserves wall and partition materials when the wall is split", async () => {
  const { g, face, ref } = scene(),
    wall = Object.values(g.faces).find((f) => f.id !== face.id)!;
  expect(useEditor.getState().setFaceColor(ref, "#cc8844").status).toBe(
    "applied",
  );
  expect(
    useEditor.getState().setFaceColor({ ...ref, entityId: wall.id }, "#4488cc")
      .status,
  ).toBe("applied");
  const before = model();
  expect(
    (
      await useEditor.getState().editGeometry(ref, {
        kind: "translate-entities",
        entities: [{ kind: "face", id: face.id }],
        delta: [0, 0, -1],
        copy: false,
      })
    ).status,
  ).toBe("applied");
  expect(model().g.faces[face.id].frontMaterialId).toBe(
    before.g.faces[face.id].frontMaterialId,
  );
  for (const f of Object.values(model().g.faces).filter(
    (f) => f.id !== face.id,
  ))
    expect(f.frontMaterialId).toBe(before.g.faces[wall.id].frontMaterialId);
});

it("keeps a gap as separate geometry rather than joining by screen proximity", async () => {
  const { face, ref } = scene();
  expect(
    (
      await useEditor.getState().editGeometry(ref, {
        kind: "translate-entities",
        entities: [{ kind: "face", id: face.id }],
        delta: [0, 0, -0.9],
        copy: false,
      })
    ).status,
  ).toBe("applied");
  expect(Object.keys(model().g.bodies)).toHaveLength(2);
  expect(Object.keys(model().g.faces)).toHaveLength(2);
});

it("rejects passing through the wall without changing the document or redo", async () => {
  const { face, ref } = scene();
  useEditor.getState().mutate("name", (p) => {
    p.name = "changed";
  });
  useEditor.getState().undo();
  const before = useEditor.getState();
  expect(before.canRedo).toBe(true);
  expect(
    (
      await useEditor.getState().editGeometry(ref, {
        kind: "translate-entities",
        entities: [{ kind: "face", id: face.id }],
        delta: [0, 0, -1.5],
        copy: false,
      })
    ).status,
  ).toBe("rejected");
  expect(useEditor.getState().project).toBe(before.project);
  expect(useEditor.getState().revision).toBe(before.revision);
  expect(useEditor.getState().canRedo).toBe(true);
});

it("joins surfaces in a rotated nonuniform group using a physical world delta", async () => {
  const { face, ref } = scene();
  useEditor.getState().selectEntity(ref);
  expect(useEditor.getState().groupScene().status).toBe("applied");
  const node = Object.values(model().p.nodes)[0];
  expect(
    useEditor.getState().patchNode(node.id, {
      transform: {
        translation: [4, 5, 6],
        rotation: [0, Math.sin(0.2), 0, Math.cos(0.2)],
        scale: [2, 3, 0.5],
      },
    }).status,
  ).toBe("applied");
  const { p, g } = model(),
    ctx = geometryContext(p, g.id, true, [node.id]);
  const a = transformAffine([0, 0, -1], ctx.worldTransform!),
    b = transformAffine([0, 0, 0], ctx.worldTransform!);
  const delta = a.map((n, i) => n - b[i]) as [number, number, number];
  const result = await useEditor.getState().editGeometry(
    { ...ref, definitionId: g.ownerDefinitionId, occurrencePath: [node.id] },
    {
      kind: "translate-entities",
      entities: [{ kind: "face", id: face.id }],
      delta,
      copy: false,
    },
  );
  expect(result.status, JSON.stringify(result)).toBe("applied");
  expect(Object.keys(model().g.faces)).toHaveLength(3);
  expect(model().p.nodes).toEqual(p.nodes);
});

it("keeps a true opening empty when the contact crosses it", async () => {
  const { face, ref } = scene();
  const ring: [number, number, number][] = [
    [1.5, 1, 0],
    [2.5, 1, 0],
    [2.5, 2, 0],
    [1.5, 2, 0],
  ];
  expect(
    (
      await useEditor.getState().drawSegments(
        [],
        ring.map((a, i) => [a, ring[(i + 1) % 4]]),
      )
    ).status,
  ).toBe("applied");
  const hole = Object.values(model().g.faces).find(
    (f) => Math.abs(tessellateFace(model().g, f).area - 1) < 1e-8,
  )!;
  expect(
    (
      await useEditor
        .getState()
        .editGeometry(
          { ...ref, entityId: hole.id },
          { kind: "delete-entities", entityIds: [hole.id] },
        )
    ).status,
  ).toBe("applied");
  const result = await useEditor.getState().editGeometry(ref, {
    kind: "translate-entities",
    entities: [{ kind: "face", id: face.id }],
    delta: [0, 0, -1],
    copy: false,
  });
  expect(result.status, JSON.stringify(result)).toBe("applied");
  const wallArea = Object.values(model().g.faces)
    .filter((f) => Math.abs(f.plane.normal[2]) > 0.9)
    .reduce((n, f) => n + tessellateFace(model().g, f).area, 0);
  expect(wallArea).toBeCloseTo(11, 8);
});
it("also connects a moved boundary edge while the partition's far edge stays fixed", async () => {
  const { g, face, ref } = scene();
  const edge = Object.values(g.edges).find((e) =>
    [e.start, e.end].every((v) => g.vertices[v].position[2] === 1),
  )!;
  const result = await useEditor.getState().editGeometry(
    { ...ref, kind: "edge", entityId: edge.id },
    {
      kind: "translate-entities",
      entities: [{ kind: "edge", id: edge.id }],
      delta: [0, 0, -1],
      copy: false,
    },
  );
  expect(result.status, JSON.stringify(result)).toBe("applied");
  expect(Object.keys(model().g.faces)).toHaveLength(3);
  const source = model().g.faces[face.id];
  expect(tessellateFace(model().g, source).area).toBeCloseTo(6, 8);
  for (const v of Object.values(g.vertices).filter((v) => v.position[2] === 2))
    expect(model().g.vertices[v.id]).toEqual(v);
});

it("rejects an unsupported contact ending inside the wall without partial edits", async () => {
  const { face, ref } = scene(),
    p = structuredClone(model().p),
    g = Object.values(p.geometries)[0];
  for (const v of Object.values(g.vertices).filter((v) => v.position[0] === 2))
    v.position[1] = v.position[1] === 0 ? 0.5 : 2.5;
  useEditor.getState().replace(p);
  const before = useEditor.getState();
  expect(
    (
      await useEditor
        .getState()
        .editGeometry(ref, {
          kind: "translate-entities",
          entities: [{ kind: "face", id: face.id }],
          delta: [0, 0, -1],
          copy: false,
        })
    ).status,
  ).toBe("rejected");
  expect(useEditor.getState().project).toBe(before.project);
  expect(useEditor.getState().revision).toBe(before.revision);
});

it("does not silently connect a planar partition to an extruded solid wall", async () => {
  const { g, face, ref } = scene(),
    wall = Object.values(g.faces).find((f) => f.id !== face.id)!;
  const extrusion = await useEditor
    .getState()
    .editGeometry(
      { ...ref, entityId: wall.id },
      { kind: "extrude-face", faceId: wall.id, distance: 0.2, side: 1 },
    );
  expect(extrusion.status, JSON.stringify(extrusion)).toBe("applied");
  const before = useEditor.getState();
  expect(
    (
      await useEditor
        .getState()
        .editGeometry(ref, {
          kind: "translate-entities",
          entities: [{ kind: "face", id: face.id }],
          delta: [0, 0, -0.8],
          copy: false,
        })
    ).status,
  ).toBe("rejected");
  expect(useEditor.getState().project).toBe(before.project);
  expect(useEditor.getState().revision).toBe(before.revision);
});
