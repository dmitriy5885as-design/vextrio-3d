import {
  GeometryError,
  defaultPolicy,
  type GeometryPolicy,
  type PlaneFrame,
  type Vec3,
} from "./model";
import {
  assertVector,
  validateTransform,
  cross,
  length,
  multiply,
  type PlacementTransform,
} from "./math";
export type AffineTransform = number[]; // column-major homogeneous 4x4
export const identityMatrix = (): AffineTransform => [
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
];
export function multiplyMatrices(
  a: AffineTransform,
  b: AffineTransform,
): AffineTransform {
  return Array.from({ length: 16 }, (_, i) => {
    const row = i % 4,
      column = Math.floor(i / 4);
    return [0, 1, 2, 3].reduce(
      (sum, k) => sum + a[k * 4 + row] * b[column * 4 + k],
      0,
    );
  });
}
export function placementMatrix(t: PlacementTransform): AffineTransform {
  validateTransform(t);
  const [x, y, z, w] = t.rotation,
    [a, b, c] = t.scale;
  return [
    (1 - 2 * y * y - 2 * z * z) * a,
    (2 * x * y + 2 * z * w) * a,
    (2 * x * z - 2 * y * w) * a,
    0,
    (2 * x * y - 2 * z * w) * b,
    (1 - 2 * x * x - 2 * z * z) * b,
    (2 * y * z + 2 * x * w) * b,
    0,
    (2 * x * z + 2 * y * w) * c,
    (2 * y * z - 2 * x * w) * c,
    (1 - 2 * x * x - 2 * y * y) * c,
    0,
    ...t.translation,
    1,
  ];
}
export function inverseAffine(m: AffineTransform): AffineTransform {
  const [a, b, c, d, e, f, g, h, i] = [
      m[0],
      m[4],
      m[8],
      m[1],
      m[5],
      m[9],
      m[2],
      m[6],
      m[10],
    ],
    det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!Number.isFinite(det) || det <= 0)
    throw new GeometryError(
      "NUMERICAL_AMBIGUITY",
      "Singular or mirrored occurrence transform",
    );
  const r = [
    (e * i - f * h) / det,
    (f * g - d * i) / det,
    (d * h - e * g) / det,
    0,
    (c * h - b * i) / det,
    (a * i - c * g) / det,
    (b * g - a * h) / det,
    0,
    (b * f - c * e) / det,
    (c * d - a * f) / det,
    (a * e - b * d) / det,
    0,
    0,
    0,
    0,
    1,
  ];
  for (let row = 0; row < 3; row++)
    r[12 + row] = -(r[row] * m[12] + r[4 + row] * m[13] + r[8 + row] * m[14]);
  return r;
}
export function validateAffine(
  m: AffineTransform,
  policy: GeometryPolicy = defaultPolicy,
) {
  if (
    !Array.isArray(m) ||
    m.length !== 16 ||
    !m.every(Number.isFinite) ||
    m[3] !== 0 ||
    m[7] !== 0 ||
    m[11] !== 0 ||
    m[15] !== 1
  )
    throw new GeometryError(
      "NUMERICAL_AMBIGUITY",
      "Invalid affine occurrence matrix",
    );
  inverseAffine(m);
  const a = Array.from({ length: 3 }, (_, r) =>
    Array.from({ length: 3 }, (_, c) =>
      [0, 1, 2].reduce((s, k) => s + m[r * 4 + k] * m[c * 4 + k], 0),
    ),
  );
  // Jacobi eigenvalues of A^T A give a rotation-invariant condition estimate.
  for (let sweep = 0; sweep < 24; sweep++)
    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      const off = a[p][q];
      if (off === 0) continue;
      const tau = (a[q][q] - a[p][p]) / (2 * off),
        t = (tau >= 0 ? 1 : -1) / (Math.abs(tau) + Math.hypot(1, tau)),
        c = 1 / Math.hypot(1, t),
        s = t * c;
      for (let k = 0; k < 3; k++)
        if (k !== p && k !== q) {
          const x = a[k][p],
            y = a[k][q];
          a[k][p] = a[p][k] = c * x - s * y;
          a[k][q] = a[q][k] = s * x + c * y;
        }
      a[p][p] -= t * off;
      a[q][q] += t * off;
      a[p][q] = a[q][p] = 0;
    }
  const eigen = [a[0][0], a[1][1], a[2][2]],
    condition = Math.sqrt(Math.max(...eigen) / Math.min(...eigen));
  if (
    !Number.isFinite(condition) ||
    Math.min(...eigen) <= 0 ||
    condition > policy.maxTransformCondition * (1 + 1e-12)
  )
    throw new GeometryError(
      "NUMERICAL_AMBIGUITY",
      "Ill-conditioned occurrence transform",
    );
}
export function transformAffine(point: Vec3, m: AffineTransform): Vec3 {
  const p: Vec3 = [
    m[0] * point[0] + m[4] * point[1] + m[8] * point[2] + m[12],
    m[1] * point[0] + m[5] * point[1] + m[9] * point[2] + m[13],
    m[2] * point[0] + m[6] * point[1] + m[10] * point[2] + m[14],
  ];
  assertVector(p);
  return p;
}
export function affinePlane(plane: PlaneFrame, m: AffineTransform): PlaneFrame {
  const direction = (p: Vec3): Vec3 => [
      m[0] * p[0] + m[4] * p[1] + m[8] * p[2],
      m[1] * p[0] + m[5] * p[1] + m[9] * p[2],
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2],
    ],
    u0 = direction(plane.u),
    v0 = direction(plane.v),
    u = multiply(u0, 1 / length(u0)),
    n = cross(u, v0),
    normal = multiply(n, 1 / length(n));
  return {
    origin: transformAffine(plane.origin, m),
    u,
    v: cross(normal, u),
    normal,
  };
}
