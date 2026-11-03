import { expect, it } from "vitest";
import {
  parseProject,
  serializeProject,
  type ProjectV2,
} from "@forma/document";
import { largeContactScene as scene } from "./fixtures/large-contact-scene";
import { useEditor } from "@forma/editor";
import {
  applyDelta,
  assertFaceContacts,
  bodyVolume,
  entityTables,
  geometryFromPolygons,
  id,
  prepareExtrusion,
  tessellateFace,
  type GeometryModel,
} from "@forma/geometry";

function recessFace(g: GeometryModel) {
  return Object.values(g.faces).find((f) => {
    const dto = tessellateFace(g, f);
    return (
      Math.abs(dto.area - 1.6) < 1e-8 &&
      dto.positions.every((p) => Math.abs(p[2] - 0.15) < 1e-8)
    );
  })!;
}

it("does not exhaust contact checks on 650 spatially separated faces", () => {
  const { g, context } = scene();
  expect(() =>
    assertFaceContacts(g, new Set(Object.keys(g.faces)), context),
  ).not.toThrow();
});

it("rejects a new boundary touching a separate wire instead of welding or ignoring it", () => {
  const { g, context } = scene(),
    face = recessFace(g);
  const wire = geometryFromPolygons(
    {
      positions: [
        [0.9, 1, 0.1],
        [1.1, 1, 0.1],
      ],
      polygons: [],
      lines: [[0, 1]],
    },
    "contact-wire",
    g.ownerDefinitionId,
    face.frontMaterialId,
  );
  for (const table of entityTables) Object.assign(g[table], wire[table]);
  const before = structuredClone(g);
  expect(() =>
    prepareExtrusion(g, face.id, -0.05, 1, context, id("wire/cut")),
  ).toThrow("другого тела");
  expect(g).toEqual(before);
});

it("deepens a floor recess in a larger scene without modifying unrelated topology", () => {
  const { g, distant, context } = scene();
  const face = recessFace(g);
  expect(face).toBeDefined();
  const change = prepareExtrusion(
    g,
    face.id,
    -0.05,
    1,
    context,
    id("large/recess"),
  );
  const after = applyDelta(g, change.forward, context);
  const wall = Object.values(g.bodies).find((b) =>
    b.faceIds.includes(face.id),
  )!;
  expect(bodyVolume(after, wall.id)).toBeCloseTo(2.24, 8);
  for (const table of entityTables)
    for (const key of Object.keys(distant[table]))
      expect(after[table][key]).toEqual(g[table][key]);
  expect(applyDelta(after, change.inverse, context)).toEqual(g);
});

it("keeps sequential cuts, exact Undo/Redo and file roundtrip in common editor history", async () => {
  const { p, g } = scene(),
    face = recessFace(g);
  useEditor.getState().replace(p);
  const ref = {
    geometryId: g.id,
    definitionId: g.ownerDefinitionId,
    kind: "face" as const,
    entityId: face.id,
    occurrencePath: [],
  };
  const before = useEditor.getState().project;
  expect(
    (
      await useEditor.getState().editGeometry(ref, {
        kind: "extrude-face",
        faceId: face.id,
        distance: -0.05,
        side: 1,
      })
    ).status,
  ).toBe("applied");
  const recessed = useEditor.getState().project;
  useEditor.getState().undo();
  expect(useEditor.getState().project).toEqual(before);
  useEditor.getState().redo();
  expect(useEditor.getState().project).toEqual(recessed);
  expect(
    (
      await useEditor.getState().editGeometry(ref, {
        kind: "extrude-face",
        faceId: face.id,
        distance: -0.1,
        side: 1,
      })
    ).status,
  ).toBe("applied");
  const opened = useEditor.getState().project as ProjectV2;
  expect(opened.geometries[g.id].faces[face.id]).toBeUndefined();
  const wall = Object.values(g.bodies).find((b) =>
    b.faceIds.includes(face.id),
  )!;
  expect(bodyVolume(opened.geometries[g.id], wall.id)).toBeCloseTo(2.08, 8);
  expect(parseProject(serializeProject(opened))).toEqual(
    JSON.parse(JSON.stringify(opened)),
  );
  useEditor.getState().undo();
  expect(useEditor.getState().project).toEqual(recessed);
});

it("still rejects a cut intersecting another body's face, preserving source and redo", async () => {
  const { p, g } = scene(),
    face = recessFace(g);
  const obstacle = geometryFromPolygons(
    {
      positions: [
        [0.9, 1, 0.125],
        [1.1, 1, 0.125],
        [1, 1.5, 0.125],
      ],
      polygons: [[0, 1, 2]],
    },
    "obstacle",
    g.ownerDefinitionId,
    face.frontMaterialId,
  );
  for (const table of entityTables) Object.assign(g[table], obstacle[table]);
  useEditor.getState().replace(p);
  expect(
    useEditor.getState().mutate("Rename", (p) => {
      p.name = "Edited";
    }).status,
  ).toBe("applied");
  useEditor.getState().undo();
  const before = useEditor.getState();
  expect(before.canRedo).toBe(true);
  const result = await useEditor.getState().editGeometry(
    {
      geometryId: g.id,
      definitionId: g.ownerDefinitionId,
      kind: "face",
      entityId: face.id,
      occurrencePath: [],
    },
    { kind: "extrude-face", faceId: face.id, distance: -0.05, side: 1 },
  );
  expect(result.status).toBe("rejected");
  if (result.status === "rejected")
    expect(result.error).toContain("пересекает");
  expect(useEditor.getState().project).toBe(before.project);
  expect(useEditor.getState().revision).toBe(before.revision);
  expect(useEditor.getState().canRedo).toBe(true);
});
