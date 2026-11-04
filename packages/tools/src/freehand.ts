import type { Vec3 } from "@forma/shared";
import type { WorkPlane } from "@forma/snapping";
import {
  assertVector,
  validatePlane,
  subtract,
  dot,
  length,
} from "@forma/geometry";
export const freehandPointLimit = 128;
export function freehandSegments(
  points: readonly Vec3[],
  plane: WorkPlane,
  tolerance = 1e-7,
): [Vec3, Vec3][] {
  validatePlane(plane);
  if (points.length > freehandPointLimit)
    throw Error(
      "Один штрих ограничен 128 точками. Разделите рисование на несколько штрихов.",
    );
  const out: [Vec3, Vec3][] = [];
  let previous: Vec3 | undefined;
  for (const point of points) {
    assertVector(point);
    if (Math.abs(dot(subtract(point, plane.origin), plane.normal)) > tolerance)
      throw Error("Штрих должен лежать в одной рабочей плоскости.");
    if (previous && length(subtract(point, previous)) > tolerance)
      out.push([[...previous], [...point]]);
    previous = point;
  }
  return out;
}
