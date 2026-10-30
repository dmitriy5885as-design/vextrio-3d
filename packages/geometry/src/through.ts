import { type GeometryModel, type Face } from "./model";
import { type ValidationContext, classifyBody } from "./validate";
import { contextPlane, metric, inRegion } from "./sketch-common";
import { add, subtract, dot, multiply, projectPoint } from "./math";
import { segmentIntersections } from "./intersections";
const loopVertices = (m: GeometryModel, l: string) =>
  m.loops[l].coedgeIds.map((cid) => {
    const c = m.coedges[cid],
      e = m.edges[c.edgeId];
    return m.vertices[c.direction === 1 ? e.start : e.end].position;
  });
// Limited parallel-face push-through, not a general boolean. The complete
// profile must fit within one opposite face, without crossing existing holes.
export function extrusionStop(
  m: GeometryModel,
  face: Face,
  side: 1 | -1,
  context: ValidationContext,
): { faceId: string; distance: number } | null {
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
  // A removable patch must be surrounded by the coplanar skin. Whole-cap
  // collapse and profiles touching a side boundary are different operations.
  if (
    edges.some(
      (eid) =>
        !body.faceIds.some((id) => {
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
        }),
    )
  )
    return null;
  let nearest: { faceId: string; distance: number } | null = null;
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
