import {
  emptyGeometry,
  id,
  prepareSketch,
  validatePrepared,
  type GeometryModel,
  type Vec3,
} from "../../packages/geometry/src/index";
import { projectPoint } from "../../packages/geometry/src/math";
import { signedArea } from "../../packages/geometry/src/sketch-common";
export function createSketchExamples() {
  const context = {
    ownerDefinitionId: "example/definition",
    materialIds: new Set(["example/material"]),
  };
  const rectangle: [Vec3, Vec3][] = [
    [
      [0, 0, 0],
      [4, 0, 0],
    ],
    [
      [4, 0, 0],
      [4, 3, 0],
    ],
    [
      [4, 3, 0],
      [0, 3, 0],
    ],
    [
      [0, 3, 0],
      [0, 0, 0],
    ],
  ];
  const initial = () =>
    emptyGeometry(id("example/geometry"), id("example/definition"));
  function insert(
    before: GeometryModel,
    segments: [Vec3, Vec3][],
    name: string,
  ) {
    const operationId = id<"operation">(`example/${name}`),
      change = prepareSketch(
        before,
        { kind: "insert-segments", segments, plane: null },
        context,
        operationId,
      ),
      model = validatePrepared(before, change, context, operationId);
    const areas = Object.values(model.faces)
      .map((f) => {
        const area = (lid: string) =>
          signedArea(
            model.loops[lid].coedgeIds.map((cid) => {
              const co = model.coedges[cid],
                e = model.edges[co.edgeId];
              return projectPoint(
                model.vertices[co.direction === 1 ? e.start : e.end].position,
                f.plane,
              );
            }),
          );
        return (
          area(f.outerLoopId) + f.innerLoopIds.reduce((a, l) => a + area(l), 0)
        );
      })
      .sort((a, b) => a - b);
    return {
      name,
      input: segments,
      counts: Object.fromEntries(
        [
          "vertices",
          "edges",
          "coedges",
          "loops",
          "faces",
          "shells",
          "bodies",
        ].map((t) => [t, Object.keys(model[t as "vertices"]).length]),
      ),
      areas,
      model,
      lineage: change.lineage,
    };
  }
  const rectangleResult = insert(initial(), rectangle, "rectangle");
  const diagonal = insert(
    rectangleResult.model,
    [
      [
        [0, 0, 0],
        [4, 3, 0],
      ],
    ],
    "diagonal",
  );
  const cross = insert(
    initial(),
    [
      [
        [-2, 0, 0],
        [2, 0, 0],
      ],
      [
        [0, -2, 0],
        [0, 2, 0],
      ],
    ],
    "cross",
  );
  const nested = insert(
    rectangleResult.model,
    [
      [
        [1, 1, 0],
        [2, 1, 0],
      ],
      [
        [2, 1, 0],
        [2, 2, 0],
      ],
      [
        [2, 2, 0],
        [1, 2, 0],
      ],
      [
        [1, 2, 0],
        [1, 1, 0],
      ],
    ],
    "nested",
  );
  return {
    units: "metres",
    policyVersion: 1,
    cases: [rectangleResult, diagonal, cross, nested],
  };
}
