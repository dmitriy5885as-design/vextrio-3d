import { readFileSync } from "node:fs";
import { geometryContext, parseProject, type ProjectV2 } from "@forma/document";
import {
  entityTables,
  geometryFromPolygons,
  type PolygonData,
} from "@forma/geometry";

// Published UI-built recess plus separate imported detail in the same geometry.
export function largeContactScene() {
  const p = parseProject(
    readFileSync("docs/0.2/examples/alpha16-recess.v3d", "utf8"),
  ) as ProjectV2;
  const g = Object.values(p.geometries)[0];
  const data: PolygonData = { positions: [], polygons: [] };
  for (let i = 0; i < 650; i++) {
    const n = data.positions.length,
      x = 20 + 2 * i;
    data.positions.push([x, 0, 0], [x + 1, 0, 0], [x, 1, 0]);
    data.polygons.push([n, n + 1, n + 2]);
  }
  const distant = geometryFromPolygons(
    data,
    "distant",
    g.ownerDefinitionId,
    Object.values(g.faces)[0].frontMaterialId,
  );
  for (const table of entityTables) Object.assign(g[table], distant[table]);
  return { p, g, distant, context: geometryContext(p, g.id) };
}
