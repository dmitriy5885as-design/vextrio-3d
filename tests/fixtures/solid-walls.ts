import {
  geometryFromPolygons,
  id,
  type PolygonData,
  type Vec3,
} from "@forma/geometry";
import { emptyProjectV2 } from "@forma/document";

export function boxPolygons(min: Vec3, max: Vec3): PolygonData {
  const [a, b, c] = min,
    [x, y, z] = max;
  return {
    positions: [
      [a, b, c],
      [x, b, c],
      [x, y, c],
      [a, y, c],
      [a, b, z],
      [x, b, z],
      [x, y, z],
      [a, y, z],
    ],
    polygons: [
      [0, 3, 2, 1],
      [4, 5, 6, 7],
      [0, 1, 5, 4],
      [3, 7, 6, 2],
      [0, 4, 7, 3],
      [1, 2, 6, 5],
    ],
  };
}
export function solidWallProject(
  partitionMin: Vec3 = [1.9, 0, 1],
  partitionMax: Vec3 = [2.1, 3, 3],
) {
  const p = emptyProjectV2("Объёмный Т-стык"),
    material = "material/walls";
  p.materials[material] = {
    id: material,
    color: "#86b7c6",
    roughness: 0.7,
    metalness: 0,
  };
  const wall = boxPolygons([0, 0, 0], [4, 3, 0.2]),
    partition = boxPolygons(partitionMin, partitionMax);
  const data = {
    positions: [...wall.positions, ...partition.positions],
    polygons: [
      ...wall.polygons,
      ...partition.polygons.map((f) => f.map((i) => i + wall.positions.length)),
    ],
  };
  const g = geometryFromPolygons(
    data,
    "solid-walls",
    id(p.rootDefinitionId),
    id(material),
  );
  p.geometries[g.id] = g;
  p.definitions[p.rootDefinitionId].geometryId = g.id;
  return p;
}
