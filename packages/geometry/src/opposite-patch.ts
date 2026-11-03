import { type GeometryModel, type Vec3 } from "./model";
import { contextPlane, inRegion, metric } from "./sketch-common";
import {
  add,
  cross,
  dot,
  length,
  multiply,
  projectPoint,
  subtract,
} from "./math";
import { planeCells } from "./arrangement";
import { segmentIntersections } from "./intersections";

// Certify the union boundary without merging source faces or their materials.
// Internal dividers disappear only from this temporary coverage query.
export function oppositePatch(
  m: GeometryModel,
  seed: string,
  candidates: string[],
  ring: Vec3[],
  context: import("./validate").ValidationContext,
  allowBoundary: boolean,
): string[] | null {
  const { world, tolerance: t } = metric(m, context),
    plane = contextPlane(m.faces[seed].plane, context);
  const uses = (fid: string) =>
    [m.faces[fid].outerLoopId, ...m.faces[fid].innerLoopIds].flatMap((l) =>
      m.loops[l].coedgeIds.map((c) => m.coedges[c].edgeId),
    );
  const eligible = candidates.filter((fid) => {
    const p = contextPlane(m.faces[fid].plane, context);
    return (
      length(cross(p.normal, plane.normal)) <
        (context.policy?.angular ?? 1e-10) &&
      Math.abs(dot(subtract(p.origin, plane.origin), plane.normal)) <= t
    );
  });
  const incidence = new Map<string, string[]>();
  for (const fid of eligible)
    for (const eid of uses(fid))
      incidence.set(eid, [...(incidence.get(eid) ?? []), fid]);
  const patch = new Set([seed]),
    queue = [seed];
  for (let i = 0; i < queue.length; i++) {
    if (queue.length > 64) return null;
    for (const eid of uses(queue[i]))
      for (const fid of incidence.get(eid) ?? [])
        if (!patch.has(fid)) {
          patch.add(fid);
          queue.push(fid);
        }
  }
  if (patch.size < 2) return null;
  const edges = Object.fromEntries(
    Object.entries(m.edges).filter(([eid]) => {
      const count = (incidence.get(eid) ?? []).filter((fid) =>
        patch.has(fid),
      ).length;
      return count === 1;
    }),
  );
  const cells = planeCells({ ...m, edges }, plane, world, t);
  const profile = ring.map((v) => projectPoint(v, plane));
  const onSegment = (p: Vec3, a: Vec3, b: Vec3) => {
    const d = subtract(b, a),
      n = dot(d, d),
      k = n ? Math.max(0, Math.min(1, dot(subtract(p, a), d) / n)) : 0;
    return length(subtract(p, add(a, multiply(d, k)))) <= t;
  };
  for (const cell of cells) {
    const boundaries = [cell.outer, ...cell.holes].map((b) =>
      b.vertexIds.map((v) => world(m.vertices[v].position)),
    );
    const inside = (p: Vec3) =>
      inRegion(
        projectPoint(p, plane),
        cell.outer.points,
        cell.holes.map((h) => h.points),
      );
    const onOuter = (p: Vec3) =>
      boundaries[0].some((a, i) =>
        onSegment(p, a, boundaries[0][(i + 1) % boundaries[0].length]),
      );
    if (
      !ring.every((a, i) =>
        [a, multiply(add(a, ring[(i + 1) % ring.length]), 0.5)].every(
          (p) => inside(p) || (allowBoundary && onOuter(p)),
        ),
      )
    )
      continue;
    let valid = true;
    for (let k = 0; k < boundaries.length; k++) {
      const boundary = boundaries[k];
      for (let i = 0; i < ring.length; i++)
        for (let j = 0; j < boundary.length; j++) {
          const a = ring[i],
            b = ring[(i + 1) % ring.length],
            c = boundary[j],
            d = boundary[(j + 1) % boundary.length];
          const collinear =
            length(cross(subtract(b, a), subtract(d, c))) <=
            (context.policy?.angular ?? 1e-10) *
              length(subtract(b, a)) *
              length(subtract(d, c));
          for (const hit of segmentIntersections(a, b, c, d, t))
            if (
              !allowBoundary ||
              k > 0 ||
              (!collinear &&
                length(subtract(hit.point, a)) > t &&
                length(subtract(hit.point, b)) > t)
            )
              valid = false;
        }
      if (
        k > 0 &&
        boundary.some((p) => inRegion(projectPoint(p, plane), profile))
      )
        valid = false;
    }
    if (valid) return [...patch].sort();
  }
  return null;
}
