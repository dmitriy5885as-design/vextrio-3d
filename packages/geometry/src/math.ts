import {
  defaultPolicy,
  GeometryError,
  type GeometryPolicy,
  type PlaneFrame,
  type Vec2,
  type Vec3,
} from "./model";
export const add = (a: Vec3, b: Vec3): Vec3 => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];
export const subtract = (a: Vec3, b: Vec3): Vec3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
export const multiply = (a: Vec3, s: number): Vec3 => [
  a[0] * s,
  a[1] * s,
  a[2] * s,
];
export const dot = (a: Vec3, b: Vec3) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3) => Math.hypot(...a);
export function assertVector(v: Vec3) {
  if (
    !Array.isArray(v) ||
    v.length !== 3 ||
    !v.every(
      (n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1e9,
    )
  )
    throw new GeometryError(
      "NUMERICAL_AMBIGUITY",
      "Coordinates must be finite and within ±1e9 metres",
    );
}
export function validatePolicy(p: GeometryPolicy) {
  if (
    p.version !== 1 ||
    ![
      p.absoluteDistance,
      p.relativeDistance,
      p.angular,
      p.maxTransformCondition,
    ].every(Number.isFinite) ||
    p.absoluteDistance <= 0 ||
    p.relativeDistance < 0 ||
    p.angular <= 0 ||
    p.angular > 1e-3 ||
    p.maxTransformCondition < 1 ||
    p.maxTransformCondition > 1e8
  )
    throw new GeometryError(
      "NUMERICAL_AMBIGUITY",
      "Unsupported geometry policy",
    );
}
export function distanceTolerance(
  diagonal: number,
  policy: GeometryPolicy = defaultPolicy,
) {
  validatePolicy(policy);
  if (!Number.isFinite(diagonal) || diagonal < 0)
    throw new GeometryError("NUMERICAL_AMBIGUITY", "Invalid world extent");
  return Math.max(policy.absoluteDistance, policy.relativeDistance * diagonal);
}
export function validatePlane(
  p: PlaneFrame,
  policy: GeometryPolicy = defaultPolicy,
) {
  validatePolicy(policy);
  [p.origin, p.u, p.v, p.normal].forEach(assertVector);
  if (
    [p.u, p.v, p.normal].some(
      (v) => Math.abs(length(v) - 1) > policy.angular,
    ) ||
    Math.abs(dot(p.u, p.v)) > policy.angular ||
    length(subtract(cross(p.u, p.v), p.normal)) > policy.angular
  )
    throw new GeometryError(
      "NON_PLANAR",
      "Plane frame must be right-handed and orthonormal",
    );
}
export function projectPoint(p: Vec3, plane: PlaneFrame): Vec2 {
  const d = subtract(p, plane.origin);
  return [dot(d, plane.u), dot(d, plane.v)];
}
export function unprojectPoint(p: Vec2, plane: PlaneFrame): Vec3 {
  return add(
    plane.origin,
    add(multiply(plane.u, p[0]), multiply(plane.v, p[1])),
  );
}
export interface PlacementTransform {
  translation: Vec3;
  rotation: [number, number, number, number];
  scale: Vec3;
}
export function validateTransform(
  t: PlacementTransform,
  policy: GeometryPolicy = defaultPolicy,
) {
  validatePolicy(policy);
  assertVector(t.translation);
  assertVector(t.scale);
  if (
    !Array.isArray(t.rotation) ||
    t.rotation.length !== 4 ||
    !t.rotation.every(Number.isFinite) ||
    Math.abs(Math.hypot(...t.rotation) - 1) > policy.angular ||
    t.scale.some((s) => s <= 0) ||
    Math.max(...t.scale) / Math.min(...t.scale) > policy.maxTransformCondition
  )
    throw new GeometryError(
      "NUMERICAL_AMBIGUITY",
      "Non-invertible or ill-conditioned placement",
    );
}
function rotate(v: Vec3, q: PlacementTransform["rotation"]): Vec3 {
  const u: Vec3 = [q[0], q[1], q[2]],
    uv = cross(u, v);
  return add(v, add(multiply(uv, 2 * q[3]), multiply(cross(u, uv), 2)));
}
export function transformDirection(vector: Vec3, t: PlacementTransform): Vec3 {
  return rotate(
    [vector[0] * t.scale[0], vector[1] * t.scale[1], vector[2] * t.scale[2]],
    t.rotation,
  );
}
export function transformPlane(
  plane: PlaneFrame,
  t: PlacementTransform,
): PlaneFrame {
  validateTransform(t);
  validatePlane(plane);
  const a = transformDirection(plane.u, t),
    b = transformDirection(plane.v, t);
  const u = multiply(a, 1 / length(a)),
    n = cross(u, b),
    normal = multiply(n, 1 / length(n));
  return {
    origin: localToWorld(plane.origin, t),
    u,
    v: cross(normal, u),
    normal,
  };
}
export function localToWorld(point: Vec3, t: PlacementTransform): Vec3 {
  validateTransform(t);
  assertVector(point);
  const result = add(
    t.translation,
    rotate(
      [point[0] * t.scale[0], point[1] * t.scale[1], point[2] * t.scale[2]],
      t.rotation,
    ),
  );
  assertVector(result);
  return result;
}
export function worldToLocal(point: Vec3, t: PlacementTransform): Vec3 {
  validateTransform(t);
  assertVector(point);
  const v = rotate(subtract(point, t.translation), [
    -t.rotation[0],
    -t.rotation[1],
    -t.rotation[2],
    t.rotation[3],
  ]);
  const result: Vec3 = [
    v[0] / t.scale[0],
    v[1] / t.scale[1],
    v[2] / t.scale[2],
  ];
  assertVector(result);
  return result;
}
