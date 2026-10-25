import {
  defaultPolicy,
  GeometryError,
  type GeometryModel,
  type PlaneFrame,
  type Vec2,
  type Vec3,
} from "./model";
import {
  add,
  cross,
  dot,
  length,
  multiply,
  subtract,
  localToWorld,
  worldToLocal,
  distanceTolerance,
} from "./math";
import { inside, orientation } from "./predicates";
import type { ValidationContext } from "./validate";
import {
  affinePlane,
  transformAffine,
  inverseAffine,
  validateAffine,
} from "./affine";
import { transformPlane } from "./math";
export const contextPlane = (plane: PlaneFrame, context: ValidationContext) =>
  context.worldTransform
    ? affinePlane(plane, context.worldTransform)
    : context.placement
      ? transformPlane(plane, context.placement)
      : plane;
export const unit = (v: Vec3) => multiply(v, 1 / length(v));
export const near = (a: Vec3, b: Vec3, t: number) =>
  length(subtract(a, b)) <= t;
export function metric(
  model: GeometryModel,
  context: ValidationContext,
  extra: Vec3[] = [],
) {
  if (context.worldTransform)
    validateAffine(context.worldTransform, context.policy);
  const inverse = context.worldTransform
    ? inverseAffine(context.worldTransform)
    : null;
  const world = (p: Vec3) =>
    context.worldTransform
      ? transformAffine(p, context.worldTransform)
      : context.placement
        ? localToWorld(p, context.placement)
        : p;
  const local = (p: Vec3) =>
    inverse
      ? transformAffine(p, inverse)
      : context.placement
        ? worldToLocal(p, context.placement)
        : p;
  const points = [
    ...Object.values(model.vertices).map((v) => world(v.position)),
    ...extra.map(world),
  ];
  const min: Vec3 = [Infinity, Infinity, Infinity],
    max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points)
    p.forEach((n, i) => {
      min[i] = Math.min(min[i], n);
      max[i] = Math.max(max[i], n);
    });
  return {
    world,
    local,
    tolerance: distanceTolerance(
      points.length ? length(subtract(max, min)) : 0,
      context.policy ?? defaultPolicy,
    ),
  };
}
export function planeThrough(
  a: Vec3,
  b: Vec3,
  c: Vec3,
  tolerance: number,
): PlaneFrame | null {
  const ab = subtract(b, a),
    ac = subtract(c, a),
    n = cross(ab, ac);
  if (length(ab) <= tolerance || length(n) / length(ab) <= tolerance)
    return null;
  let normal = unit(n);
  const dominant = normal.reduce(
    (best, v, i) => (Math.abs(v) > Math.abs(normal[best]) ? i : best),
    0,
  );
  if (normal[dominant] < 0) normal = multiply(normal, -1);
  const axis: Vec3 = Math.abs(normal[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0],
    u = unit(cross(axis, normal));
  return { origin: a, u, v: cross(normal, u), normal };
}
export const onPlane = (p: Vec3, plane: PlaneFrame, t: number) =>
  Math.abs(dot(subtract(p, plane.origin), plane.normal)) <= t;
export function signedArea(points: Vec2[]) {
  const a = points[0];
  let twice = 0;
  for (let i = 1; i < points.length - 1; i++)
    twice +=
      (points[i][0] - a[0]) * (points[i + 1][1] - a[1]) -
      (points[i][1] - a[1]) * (points[i + 1][0] - a[0]);
  return twice / 2;
}
export function onBoundary(p: Vec2, polygon: Vec2[]) {
  return polygon.some((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    return (
      orientation(a, b, p) === 0 &&
      p[0] >= Math.min(a[0], b[0]) &&
      p[0] <= Math.max(a[0], b[0]) &&
      p[1] >= Math.min(a[1], b[1]) &&
      p[1] <= Math.max(a[1], b[1])
    );
  });
}
export const inRegion = (p: Vec2, outer: Vec2[], holes: Vec2[][] = []) =>
  !onBoundary(p, outer) &&
  inside(p, outer) &&
  !holes.some((h) => onBoundary(p, h) || inside(p, h));
// Scan between vertex ordinates, never use a possibly exterior concave centroid.
export function witness(outer: Vec2[], holes: Vec2[][] = []): Vec2 {
  const ys = [
    ...new Set([outer, ...holes].flatMap((p) => p.map((v) => v[1]))),
  ].sort((a, b) => a - b);
  let best: Vec2 | undefined,
    width = 0;
  for (let k = 0; k < ys.length - 1; k++) {
    const y = (ys[k] + ys[k + 1]) / 2,
      xs: number[] = [];
    for (const polygon of [outer, ...holes])
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i],
          b = polygon[(i + 1) % polygon.length];
        if ((a[1] < y && b[1] > y) || (b[1] < y && a[1] > y))
          xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
    xs.sort((a, b) => a - b);
    for (let i = 0; i < xs.length - 1; i++) {
      const p: Vec2 = [(xs[i] + xs[i + 1]) / 2, y],
        w = xs[i + 1] - xs[i];
      if (w > width && inRegion(p, outer, holes)) {
        best = p;
        width = w;
      }
    }
  }
  if (!best)
    throw new GeometryError(
      "NUMERICAL_AMBIGUITY",
      "Cannot locate a reliable interior point",
    );
  return best;
}
export const interpolate = (a: Vec3, b: Vec3, t: number) =>
  add(a, multiply(subtract(b, a), t));
