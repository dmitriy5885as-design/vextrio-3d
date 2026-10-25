import { GeometryError, type Vec3 } from "./model";
import { cross, dot, length, subtract } from "./math";
import { interpolate, near } from "./sketch-common";
export interface SegmentHit {
  a: number;
  b: number;
  point: Vec3;
}
export function segmentIntersections(
  a: Vec3,
  b: Vec3,
  c: Vec3,
  d: Vec3,
  tolerance: number,
  angular = 1e-10,
): SegmentHit[] {
  const u = subtract(b, a),
    v = subtract(d, c),
    w = subtract(c, a),
    lu = length(u),
    lv = length(v);
  if (lu <= tolerance || lv <= tolerance)
    throw new GeometryError(
      "DEGENERATE",
      "Segment is shorter than geometry tolerance",
    );
  const n = cross(u, v),
    ln = length(n),
    hits: SegmentHit[] = [];
  const clamp = (t: number) => Math.max(0, Math.min(1, t));
  function add(t: number, s: number) {
    if (
      t < -tolerance / lu ||
      t > 1 + tolerance / lu ||
      s < -tolerance / lv ||
      s > 1 + tolerance / lv
    )
      return;
    const ta = clamp(t),
      tb = clamp(s),
      pa = interpolate(a, b, ta),
      pb = interpolate(c, d, tb);
    if (!near(pa, pb, tolerance)) return;
    const p =
      ta === 0
        ? a
        : ta === 1
          ? b
          : tb === 0
            ? c
            : tb === 1
              ? d
              : interpolate(pa, pb, 0.5);
    if (!hits.some((h) => near(h.point, p, tolerance)))
      hits.push({ a: ta, b: tb, point: p });
  }
  const collinear =
    ln === 0 ||
    (ln <= angular * lu * lv &&
      [c, d].every((p) => length(cross(subtract(p, a), u)) / lu <= tolerance) &&
      [a, b].every((p) => length(cross(subtract(p, c), v)) / lv <= tolerance));
  if (collinear) {
    if (length(cross(w, u)) / lu > tolerance) return [];
    for (const [p, t] of [
      [a, 0],
      [b, 1],
    ] as const)
      add(t, dot(subtract(p, c), v) / (lv * lv));
    for (const [p, s] of [
      [c, 0],
      [d, 1],
    ] as const)
      add(dot(subtract(p, a), u) / (lu * lu), s);
  } else {
    const denom = dot(n, n);
    add(dot(cross(w, v), n) / denom, dot(cross(w, u), n) / denom);
    // Endpoint-on-edge snapping handles roundoff near T junctions explicitly.
    for (const [p, t] of [
      [a, 0],
      [b, 1],
    ] as const)
      add(t, dot(subtract(p, c), v) / (lv * lv));
    for (const [p, s] of [
      [c, 0],
      [d, 1],
    ] as const)
      add(dot(subtract(p, a), u) / (lu * lu), s);
  }
  return hits;
}
