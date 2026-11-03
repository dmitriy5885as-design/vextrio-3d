import type { Vec3 } from "@forma/shared";
import { add, dot, multiply, subtract, length } from "@forma/geometry";
import type { SnapCandidate } from "./engine";
export const depthSnapKinds = [
  "vertex",
  "endpoint",
  "midpoint",
  "edge",
  "face",
  "intersection",
] as const;
// Align the moving plane to the world-space level of a real topology point.
// This does not certify a boolean contact; the geometry command still validates it.
export function resolveDepthSnap(
  anchor: Vec3,
  normal: Vec3,
  free: number,
  candidate: SnapCandidate | null,
  limit: number | null,
) {
  if (
    !Number.isFinite(free) ||
    [...anchor, ...normal].some((v) => !Number.isFinite(v)) ||
    length(normal) < 1e-12
  )
    throw Error("Некорректное направление глубины.");
  const fallback = {
    distance: free,
    candidate: null as SnapCandidate | null,
    level: null as Vec3 | null,
  };
  if (
    !candidate?.ref ||
    !depthSnapKinds.some((k) => k === candidate.kind) ||
    candidate.point.some((v) => !Number.isFinite(v))
  )
    return fallback;
  const axis = multiply(normal, 1 / length(normal)),
    distance = dot(subtract(candidate.point, anchor), axis);
  if (Math.abs(distance) <= 1e-8 || (limit !== null && distance < limit - 1e-8))
    return fallback;
  return { distance, candidate, level: add(anchor, multiply(axis, distance)) };
}
