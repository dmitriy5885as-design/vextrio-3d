import { type GeometryModel, type Face, type Vec3 } from "./model";
import { type ValidationContext, classifyBody } from "./validate";
import { contextPlane, metric, inRegion } from "./sketch-common";
import {
  add,
  subtract,
  dot,
  multiply,
  projectPoint,
  cross,
  length,
} from "./math";
import { segmentIntersections } from "./intersections";
export const loopVertices = (m: GeometryModel, l: string) =>
  m.loops[l].coedgeIds.map((cid) => {
    const c = m.coedges[cid],
      e = m.edges[c.edgeId];
    return m.vertices[c.direction === 1 ? e.start : e.end].position;
  });
export interface ExtrusionStop {
  faceId: string;
  distance: number;
  boundaryEdges?: { edgeId: string; faceId: string }[];
}
export function onSegment(p: Vec3, a: Vec3, b: Vec3, t: number) {
  const d = subtract(b, a),
    n = dot(d, d);
  const k = n ? Math.max(0, Math.min(1, dot(subtract(p, a), d) / n)) : 0;
  return length(subtract(p, add(a, multiply(d, k)))) <= t;
}
// A complete ring may share an outer boundary, but may not cross it or touch
// a hole. Test segments as well as vertices so concave skins cannot be skipped.
export function containsRing(
  m: GeometryModel,
  f: Face,
  ring: Vec3[],
  context: ValidationContext,
) {
  const { world, tolerance: t } = metric(m, context),
    plane = contextPlane(f.plane, context);
  const boundaries = [f.outerLoopId, ...f.innerLoopIds].map((l) =>
    loopVertices(m, l).map(world),
  );
  const polygons = boundaries.map((r) => r.map((v) => projectPoint(v, plane)));
  const onOuter = (v: Vec3) =>
    boundaries[0].some((a, i) =>
      onSegment(v, a, boundaries[0][(i + 1) % boundaries[0].length], t),
    );
  if (
    !ring.every((a, i) =>
      [a, multiply(add(a, ring[(i + 1) % ring.length]), 0.5)].every(
        (v) =>
          Math.abs(dot(subtract(v, plane.origin), plane.normal)) <= t &&
          (inRegion(projectPoint(v, plane), polygons[0], polygons.slice(1)) ||
            onOuter(v)),
      ),
    )
  )
    return false;
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
        for (const h of segmentIntersections(a, b, c, d, t))
          if (
            k > 0 ||
            (!collinear &&
              length(subtract(h.point, a)) > t &&
              length(subtract(h.point, b)) > t)
          )
            return false;
      }
    if (
      k > 0 &&
      boundary.some((v) =>
        inRegion(
          projectPoint(v, plane),
          ring.map((v) => projectPoint(v, plane)),
        ),
      )
    )
      return false;
  }
  return true;
}
// Limited parallel-face push-through, not a general boolean. The complete
// profile must fit within one opposite face, without crossing existing holes.
export function extrusionStop(
  m: GeometryModel,
  face: Face,
  side: 1 | -1,
  context: ValidationContext,
): ExtrusionStop | null {
  const body = Object.values(m.bodies).find((b) => b.faceIds.includes(face.id));
  if (
    !body ||
    classifyBody(m, body.id) !== "closed-shell" ||
    face.innerLoopIds.length
  )
    return null;
  const { world, tolerance } = metric(m, context),
    plane = contextPlane(face.plane, context),
    direction = multiply(plane.normal, -side),
    edges = m.loops[face.outerLoopId].coedgeIds.map((c) => m.coedges[c].edgeId);
  const shellUses = body.shellIds.flatMap((s) => m.shells[s].faces),
    orientation = shellUses.find((u) => u.faceId === face.id)?.orientation ?? 1;
  if (orientation !== side) return null;
  const boundaryEdges: NonNullable<ExtrusionStop["boundaryEdges"]> = [];
  let interiorEdges = 0;
  for (const eid of edges) {
    const neighbors = body.faceIds.filter(
      (id) =>
        id !== face.id &&
        [m.faces[id].outerLoopId, ...m.faces[id].innerLoopIds].some((l) =>
          m.loops[l].coedgeIds.some((c) => m.coedges[c].edgeId === eid),
        ),
    );
    if (
      neighbors.some((id) => {
        if (id === face.id) return false;
        const f = m.faces[id],
          p = contextPlane(f.plane, context);
        return (
          Math.abs(Math.abs(dot(p.normal, plane.normal)) - 1) < 1e-8 &&
          Math.abs(dot(subtract(p.origin, plane.origin), plane.normal)) <=
            tolerance &&
          [f.outerLoopId, ...f.innerLoopIds].some((l) =>
            m.loops[l].coedgeIds.some((c) => m.coedges[c].edgeId === eid),
          )
        );
      })
    ) {
      interiorEdges++;
      continue;
    }
    if (
      neighbors.length !== 1 ||
      Math.abs(
        dot(
          contextPlane(m.faces[neighbors[0]].plane, context).normal,
          direction,
        ),
      ) > 1e-8
    )
      return null;
    boundaryEdges.push({ edgeId: eid, faceId: neighbors[0] });
  }
  // Reject whole-cap collapse and corner-only contacts; a notch needs skin.
  if (!interiorEdges) return null;
  let nearest: ExtrusionStop | null = null;
  for (const fid of body.faceIds) {
    if (fid === face.id) continue;
    const other = m.faces[fid],
      p = contextPlane(other.plane, context),
      orientation = shellUses.find((u) => u.faceId === fid)?.orientation ?? 1;
    if (dot(multiply(p.normal, orientation), direction) < 1 - 1e-8) continue;
    const depth =
      dot(subtract(p.origin, plane.origin), p.normal) /
      dot(direction, p.normal);
    if (depth <= tolerance || (nearest && depth >= -nearest.distance)) continue;
    const ring = loopVertices(m, face.outerLoopId).map((v) =>
        add(world(v), multiply(direction, depth)),
      ),
      boundaries = [other.outerLoopId, ...other.innerLoopIds].map((l) =>
        loopVertices(m, l).map(world),
      ),
      polygons = boundaries.map((r) => r.map((v) => projectPoint(v, p))),
      profile = ring.map((v) => projectPoint(v, p));
    if (boundaryEdges.length) {
      if (!containsRing(m, other, ring, context)) continue;
      if (
        boundaryEdges.some(({ edgeId, faceId }) => {
          const e = m.edges[edgeId],
            a = world(m.vertices[e.start].position),
            b = world(m.vertices[e.end].position);
          return !containsRing(
            m,
            m.faces[faceId],
            [
              a,
              b,
              add(b, multiply(direction, depth)),
              add(a, multiply(direction, depth)),
            ],
            context,
          );
        })
      )
        continue;
      nearest = { faceId: fid, distance: -depth, boundaryEdges };
      continue;
    }
    if (
      !ring.every((v) =>
        inRegion(projectPoint(v, p), polygons[0], polygons.slice(1)),
      )
    )
      continue;
    if (
      boundaries.some((boundary) =>
        ring.some((a, i) =>
          boundary.some(
            (b, j) =>
              segmentIntersections(
                a,
                ring[(i + 1) % ring.length],
                b,
                boundary[(j + 1) % boundary.length],
                tolerance,
              ).length,
          ),
        ),
      )
    )
      continue;
    if (polygons.slice(1).some((h) => h.some((v) => inRegion(v, profile))))
      continue;
    nearest = { faceId: fid, distance: -depth };
  }
  return nearest;
}
