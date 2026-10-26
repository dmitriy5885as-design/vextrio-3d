import { precisionProject } from "./precision-project";
import {
  SnapEngine,
  resolvePrecision,
  workPlane,
  type SnapQuery,
} from "@forma/snapping";
import { emptyGeometry, id, identityMatrix, type Vec3 } from "@forma/geometry";
import { serializeProject } from "@forma/document";
export function createPrecisionExamples() {
  const p = precisionProject(),
    engine = new SnapEngine(p);
  const query = (point: Vec3): SnapQuery => ({
    cursor: [point[0] * 100, point[1] * 100],
    project: (v) => ({
      x: v[0] * 100,
      y: v[1] * 100,
      depth: 10 - v[2],
      visible: v[2] < 10,
      w: 1,
    }),
    ray: { origin: [point[0], point[1], 10], direction: [0, 0, -1] },
    plane: workPlane("XY"),
    anchor: [-10, -13, 0],
    axes: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    gridStep: 0,
    enabled: true,
  });
  const snaps = (
    [
      [0, 0, 0],
      [2, 0, 0],
      [1.23, 0.02, 0],
    ] as Vec3[]
  ).map((cursor) => {
    engine.reset();
    const r = engine.query(query(cursor));
    return {
      cursor,
      kind: r.candidate?.kind,
      point: r.candidate?.point,
      ref: r.candidate?.ref,
      stats: { ...engine.stats },
    };
  });
  const dimensions = resolvePrecision({
    text: "4000,125 мм;0;0",
    mode: "coordinates",
    unit: "m",
    anchor: [0, 0, 0],
    direction: [1, 0, 0],
    system: "world",
    matrix: identityMatrix(),
    plane: workPlane("XY"),
    relative: false,
  });
  const many = precisionProject(),
    g = emptyGeometry(id("many"), id(many.rootDefinitionId));
  for (let i = 0; i < 10000; i++) {
    const a = id<"vertex">(`a${i}`),
      b = id<"vertex">(`b${i}`),
      e = id<"edge">(`e${i}`);
    g.vertices[a] = { id: a, position: [i * 10, 0, 0] };
    g.vertices[b] = { id: b, position: [i * 10 + 2, 0, 0] };
    g.edges[e] = { id: e, start: a, end: b, curve: { kind: "line" } };
  }
  many.geometries = { many: g };
  many.definitions[many.rootDefinitionId].geometryId = g.id;
  const index = new SnapEngine(many);
  index.query(query([50000, 0, 0]));
  return {
    version: 1,
    project: serializeProject(p),
    examples: {
      input: "4000,125 мм;0;0",
      dimensions,
      snaps,
      index: { sources: index.sourceCount, ...index.stats },
    },
  };
}
