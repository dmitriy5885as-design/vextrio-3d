import type { PlaneFrame, Vec3 } from "./model";
import {
  add,
  subtract,
  multiply,
  dot,
  cross,
  length,
  assertVector,
  validatePlane,
} from "./math";

/** A physical, orthonormal chord frame in the supplied working plane. */
export function arcChordFrame(
  start: Vec3,
  end: Vec3,
  plane: PlaneFrame,
  tolerance = 1e-7,
) {
  if (!Number.isFinite(tolerance) || tolerance <= 0)
    throw Error("Недопустимый геометрический допуск.");
  assertVector(start);
  assertVector(end);
  validatePlane(plane);
  const delta = subtract(end, start),
    size = length(delta);
  if (size <= tolerance) throw Error("Концы дуги должны различаться.");
  if (Math.abs(dot(delta, plane.normal)) > Math.max(tolerance, size * 1e-12))
    throw Error("Концы дуги должны лежать в одной рабочей плоскости.");
  // Project numerical residue onto the plane before normalising.
  const projected = subtract(
      delta,
      multiply(plane.normal, dot(delta, plane.normal)),
    ),
    along = multiply(projected, 1 / length(projected));
  return {
    midpoint: add(start, multiply(delta, 0.5)),
    along,
    perpendicular: cross(plane.normal, along),
    halfChord: length(projected) / 2,
  };
}
export interface ArcProfile {
  segments: [Vec3, Vec3][];
  center: Vec3;
  radius: number;
  /** Signed sagitta; its sign follows normal × (end - start). */
  bulge: number;
  /** Signed sweep in radians, measured about the plane normal. */
  sweep: number;
}

/** Two fixed endpoints and a point on the curved side. No renderer data.
 * The cursor point is retained as a vertex, so a snapped point is not lost to
 * tessellation. Segment budget is split proportionally on either side of it.
 */
export function arcProfile(
  start: Vec3,
  end: Vec3,
  point: Vec3,
  plane: PlaneFrame,
  sides = 12,
  tolerance = 1e-7,
): ArcProfile {
  if (!Number.isInteger(sides) || sides < 2 || sides > 128)
    throw Error("Число сегментов дуги должно быть целым от 2 до 128.");
  const {
    midpoint,
    along,
    perpendicular,
    halfChord: l,
  } = arcChordFrame(start, end, plane, tolerance);
  assertVector(point);
  // Evaluate trigonometry from the same endpoint regardless of drawing
  // direction; reverse only the final pairs, never their coordinates.
  const order = start.findIndex((v, i) => v !== end[i]);
  if (start[order] > end[order]) {
    const canonical = arcProfile(end, start, point, plane, sides, tolerance);
    return {
      ...canonical,
      segments: [...canonical.segments].reverse().map(([a, b]) => [b, a]),
      bulge: -canonical.bulge,
      sweep: -canonical.sweep,
    };
  }
  const delta = subtract(point, midpoint),
    x = dot(delta, along),
    y = dot(delta, perpendicular);
  if (
    Math.abs(dot(subtract(point, start), plane.normal)) >
    Math.max(tolerance, length(delta) * 1e-12)
  )
    throw Error("Точка выпуклости должна лежать в рабочей плоскости.");
  if (
    Math.abs(y) <= tolerance ||
    length(subtract(point, start)) <= tolerance ||
    length(subtract(point, end)) <= tolerance
  )
    throw Error("Выпуклость дуги должна быть больше геометрического допуска.");
  const offset = (x * x + y * y - l * l) / (2 * y),
    radius = Math.hypot(l, offset),
    side = Math.sign(y),
    // Avoid subtracting nearly equal radius/offset for shallow arcs.
    bulge =
      side * offset > 0
        ? offset + side * radius
        : (side * l * l) / (radius - side * offset),
    sweep = -4 * Math.atan2(bulge, l),
    center = add(midpoint, multiply(perpendicular, offset));
  if (
    ![radius, bulge, sweep, ...center].every(Number.isFinite) ||
    Math.abs(bulge) <= tolerance ||
    Math.abs(sweep) >= 2 * Math.PI
  )
    throw Error("Дуга численно неустойчива. Измените концы или выпуклость.");
  // atan2 in the plane avoids depending on a Three.js curve or its sampling.
  let via = Math.atan2(
    offset * (l + x) - l * y,
    offset * offset - offset * y - l * x,
  );
  if (sweep < 0 && via > 0) via -= 2 * Math.PI;
  if (sweep > 0 && via < 0) via += 2 * Math.PI;
  const fraction = via / sweep;
  if (!(fraction > 0 && fraction < 1))
    throw Error("Точка дуги не определяет устойчивый контур.");
  const left = Math.max(1, Math.min(sides - 1, Math.round(sides * fraction))),
    right = sides - left,
    radial = subtract(start, center),
    tangent = cross(plane.normal, radial),
    points: Vec3[] = Array.from({ length: sides + 1 }, (_, i) => {
      if (i === 0) return [...start];
      if (i === sides) return [...end];
      if (i === left) return [...point];
      const angle =
          i < left
            ? (via * i) / left
            : via + ((sweep - via) * (i - left)) / right,
        // cos(angle)-1 loses the whole sagitta for very shallow arcs.
        cosineMinusOne = -2 * Math.sin(angle / 2) ** 2;
      const p = add(
        start,
        add(
          multiply(radial, cosineMinusOne),
          multiply(tangent, Math.sin(angle)),
        ),
      );
      assertVector(p);
      return p;
    });
  const segments: [Vec3, Vec3][] = points
    .slice(0, -1)
    .map((p, i) => [p, points[i + 1]]);
  if (segments.some(([a, b]) => length(subtract(a, b)) <= tolerance))
    throw Error(
      "Сегмент дуги меньше геометрического допуска. Уменьшите число сегментов.",
    );
  return { segments, center, radius, bulge, sweep };
}
