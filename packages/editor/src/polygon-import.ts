import {
  id,
  geometryFromPolygons,
  type PolygonData,
  type Vec3,
} from "@forma/geometry";
import { identityPlacement, type ProjectV2 } from "@forma/document";
import type { Primitive } from "@forma/shared";
export function insertPolygonPart(
  p: ProjectV2,
  data: PolygonData,
  name: string,
  parent = p.rootDefinitionId,
  nodeId?: string,
  materialId?: string,
) {
  const ns = "import/" + crypto.randomUUID(),
    did = id<"definition">(ns + "/definition"),
    nid = id<"node">(nodeId ?? ns + "/node"),
    mid = id<"material">(materialId ?? ns + "/material");
  if (!materialId)
    p.materials[mid] = {
      id: mid,
      color: "#82b8df",
      roughness: 0.65,
      metalness: 0.05,
    };
  const model = geometryFromPolygons(data, ns, did, mid);
  p.geometries[model.id] = model;
  p.definitions[did] = {
    id: did,
    kind: "group",
    name: name.slice(0, 200) || "Импорт",
    geometryId: model.id,
    childNodeIds: [],
  };
  p.nodes[nid] = {
    id: nid,
    kind: "group",
    name: name.slice(0, 200) || "Импорт",
    parentDefinitionId: id<"definition">(parent),
    definitionId: did,
    transform: identityPlacement(),
    visible: true,
    locked: false,
  };
  if (!nodeId) p.definitions[parent].childNodeIds.push(nid);
  return nid;
}
export function primitivePolygons(kind: Primitive, size: number): PolygonData {
  const h = size / 2;
  if (kind === "cube")
    return {
      positions: [
        [-h, -h, -h],
        [h, -h, -h],
        [h, h, -h],
        [-h, h, -h],
        [-h, -h, h],
        [h, -h, h],
        [h, h, h],
        [-h, h, h],
      ],
      polygons: [
        [0, 3, 2, 1],
        [4, 5, 6, 7],
        [0, 1, 5, 4],
        [3, 7, 6, 2],
        [1, 2, 6, 5],
        [0, 4, 7, 3],
      ],
    };
  if (kind === "plane")
    return {
      positions: [
        [-h, 0, -h],
        [-h, 0, h],
        [h, 0, h],
        [h, 0, -h],
      ],
      polygons: [[0, 1, 2, 3]],
    };
  const positions: Vec3[] = [],
    polygons: number[][] = [],
    count = 40;
  if (kind === "cylinder") {
    for (const y of [-h, h])
      for (let i = 0; i < count; i++) {
        const t = (i * 2 * Math.PI) / count;
        positions.push([h * Math.cos(t), y, h * Math.sin(t)]);
      }
    polygons.push(
      Array.from({ length: count }, (_, i) => i),
      Array.from({ length: count }, (_, i) => 2 * count - i - 1),
    );
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      polygons.push([i, i + count, j + count, j]);
    }
  } else {
    // Match the original sphere's 40 longitude / 24 latitude segmentation.
    positions.push([0, h, 0]);
    const rows = 24;
    for (let row = 1; row < rows; row++)
      for (let i = 0; i < count; i++) {
        const phi = (row * Math.PI) / rows,
          t = (i * 2 * Math.PI) / count;
        positions.push([
          h * Math.sin(phi) * Math.cos(t),
          h * Math.cos(phi),
          h * Math.sin(phi) * Math.sin(t),
        ]);
      }
    const bottom = positions.length;
    positions.push([0, -h, 0]);
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      polygons.push([0, 1 + j, 1 + i]);
      for (let row = 0; row < rows - 2; row++) {
        const a = 1 + row * count + i,
          b = 1 + row * count + j;
        polygons.push([a, b, b + count], [a, b + count, a + count]);
      }
      polygons.push([
        bottom,
        1 + (rows - 2) * count + i,
        1 + (rows - 2) * count + j,
      ]);
    }
  }
  return { positions, polygons };
}
