import { it, expect } from "vitest";
import { sketchSegments, ToolController, freehandSegments } from "@forma/tools";
import { workPlane } from "@forma/snapping";
import { useEditor } from "@forma/editor";
import {
  emptyProjectV2,
  type ProjectV2,
  serializeProject,
  parseProject,
} from "@forma/document";
import { bodyVolume, tessellateFace } from "@forma/geometry";
it("builds a six-sided real face with circumradius 2m and extrudes to 18√3m³", async () => {
  const plane = workPlane("XZ"),
    segments = sketchSegments("polygon", [0, 0, 0], [2, 0, 0], plane, 1e-7, 6);
  expect(segments).toHaveLength(6);
  useEditor.getState().replace(emptyProjectV2());
  expect((await useEditor.getState().drawSegments([], segments)).status).toBe(
    "applied",
  );
  let p = useEditor.getState().project as ProjectV2,
    g = Object.values(p.geometries)[0],
    face = Object.values(g.faces)[0];
  expect(tessellateFace(g, face).area).toBeCloseTo(6 * Math.sqrt(3), 8);
  const before = p;
  expect(
    (
      await useEditor
        .getState()
        .editGeometry(
          {
            definitionId: g.ownerDefinitionId,
            geometryId: g.id,
            entityId: face.id,
            kind: "face",
            occurrencePath: [],
          },
          { kind: "extrude-face", faceId: face.id, distance: 3, side: 1 },
        )
    ).status,
  ).toBe("applied");
  p = useEditor.getState().project as ProjectV2;
  g = Object.values(p.geometries)[0];
  expect(bodyVolume(g, Object.keys(g.bodies)[0])).toBeCloseTo(
    18 * Math.sqrt(3),
    8,
  );
  expect(serializeProject(parseProject(serializeProject(p)))).toBe(
    serializeProject(p),
  );
  useEditor.getState().undo();
  expect(useEditor.getState().project).toEqual(before);
});
it("keeps polygon and circle side counts independent and refuses invalid counts", () => {
  const c = new ToolController({
    preview: async () => ({ status: "preview" }),
    commit: async () => ({ status: "applied" }),
  });
  const p = workPlane("XZ");
  expect(c.setPolygonSides(5, p)).toBe(true);
  expect(c.state.circleSides).toBe(24);
  expect(c.setPolygonSides(2, p)).toBe(false);
  expect(c.state.polygonSides).toBe(5);
  expect(() =>
    sketchSegments("polygon", [0, 0, 0], [1, 0, 0], p, 1e-7, 129),
  ).toThrow();
});
it("a closed freehand stroke creates one face in a single reversible command", async () => {
  useEditor.getState().replace(emptyProjectV2());
  const before = useEditor.getState().project,
    segments = freehandSegments(
      [
        [0, 0, 0],
        [2, 0, 0],
        [2, 0, 2],
        [0, 0, 2],
        [0, 0, 0],
      ],
      workPlane("XZ"),
    );
  expect((await useEditor.getState().drawSegments([], segments)).status).toBe(
    "applied",
  );
  const after = useEditor.getState().project as ProjectV2,
    g = Object.values(after.geometries)[0];
  expect(Object.keys(g.faces)).toHaveLength(1);
  expect(tessellateFace(g, Object.values(g.faces)[0]).area).toBeCloseTo(4);
  useEditor.getState().undo();
  expect(useEditor.getState().project).toEqual(before);
  useEditor.getState().redo();
  expect(useEditor.getState().project).toEqual(after);
});
it("rejects a nonplanar stroke and the resource limit without mutating input", () => {
  const p = workPlane("XZ"),
    points: [[number, number, number], [number, number, number]] = [
      [0, 0, 0],
      [1, 1, 1],
    ];
  const before = JSON.stringify(points);
  expect(() => freehandSegments(points, p)).toThrow();
  expect(JSON.stringify(points)).toBe(before);
  expect(() =>
    freehandSegments(
      Array.from({ length: 129 }, (_, i) => [i, 0, 0]),
      p,
    ),
  ).toThrow();
  expect(
    freehandSegments(
      [
        [0, 0, 0],
        [0, 0, 0],
      ],
      p,
    ),
  ).toEqual([]);
});
