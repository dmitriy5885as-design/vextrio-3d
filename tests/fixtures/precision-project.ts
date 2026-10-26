import { emptyProjectV2, type ProjectV2 } from "@forma/document";
import {
  emptyGeometry,
  id,
  prepareSketch,
  validatePrepared,
  type Vec3,
} from "@forma/geometry";
export function precisionProject(
  segments: [Vec3, Vec3][] = [
    [
      [0, 0, 0],
      [4, 0, 0],
    ],
  ],
): ProjectV2 {
  const p = emptyProjectV2("Точное позиционирование"),
    gid = id<"geometry">("precision/geometry");
  let g = emptyGeometry(gid, id(p.rootDefinitionId));
  const context = {
    ownerDefinitionId: p.rootDefinitionId,
    materialIds: new Set<string>(),
  };
  g = validatePrepared(
    g,
    prepareSketch(
      g,
      { kind: "insert-segments", segments, plane: null },
      context,
      id("precision/seed"),
    ),
    context,
    id("precision/seed"),
  );
  p.geometries[gid] = g;
  p.definitions[p.rootDefinitionId].geometryId = gid;
  p.camera = {
    position: [6, 5, 10],
    target: [2, 0, 0],
    projection: "perspective",
    zoom: 1,
  };
  return p;
}
