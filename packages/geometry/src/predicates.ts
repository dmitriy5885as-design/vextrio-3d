import { GeometryError, type Vec2 } from "./model";
// Every finite IEEE-754 binary64 value is an integer multiple of 2^-1074.
// Evaluate determinant signs in that exact integer lattice, including subnormals.
// This is a bounded, allocation-heavy reference predicate, not the S3 fast path.
function integer(n: number): bigint {
  if (!Number.isFinite(n))
    throw new GeometryError(
      "NUMERICAL_AMBIGUITY",
      "Non-finite predicate input",
    );
  const bytes = new DataView(new ArrayBuffer(8));
  bytes.setFloat64(0, n);
  const bits = bytes.getBigUint64(0),
    exponent = Number((bits >> 52n) & 2047n),
    fraction = bits & ((1n << 52n) - 1n);
  const value =
    exponent === 0
      ? fraction
      : ((1n << 52n) | fraction) << BigInt(exponent - 1);
  return bits >> 63n ? -value : value;
}
export function orientation(a: Vec2, b: Vec2, c: Vec2): -1 | 0 | 1 {
  const ax = integer(a[0]),
    ay = integer(a[1]),
    bx = integer(b[0]),
    by = integer(b[1]),
    cx = integer(c[0]),
    cy = integer(c[1]);
  const determinant = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  return determinant > 0n ? 1 : determinant < 0n ? -1 : 0;
}
export function segmentsTouch(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const on = (p: Vec2, q: Vec2, r: Vec2) =>
    r[0] >= Math.min(p[0], q[0]) &&
    r[0] <= Math.max(p[0], q[0]) &&
    r[1] >= Math.min(p[1], q[1]) &&
    r[1] <= Math.max(p[1], q[1]);
  const abC = orientation(a, b, c),
    abD = orientation(a, b, d),
    cdA = orientation(c, d, a),
    cdB = orientation(c, d, b);
  return (
    (abC === 0 && on(a, b, c)) ||
    (abD === 0 && on(a, b, d)) ||
    (cdA === 0 && on(c, d, a)) ||
    (cdB === 0 && on(c, d, b)) ||
    (abC * abD < 0 && cdA * cdB < 0)
  );
}
export function inside(point: Vec2, polygon: Vec2[]): boolean {
  let winding = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length],
      sign = orientation(a, b, point);
    if (a[1] <= point[1] && b[1] > point[1] && sign > 0) winding++;
    if (a[1] > point[1] && b[1] <= point[1] && sign < 0) winding--;
  }
  return winding !== 0;
}
