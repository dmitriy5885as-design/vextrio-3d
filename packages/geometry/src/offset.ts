import { inflatePaths, JoinType, EndType } from "clipper2-ts";
import {
  GeometryError,
  type GeometryModel,
  type PlaneFrame,
  type Vec2,
  type Vec3,
  type Id,
} from "./model";
import {
  add,
  subtract,
  multiply,
  dot,
  cross,
  length,
  projectPoint,
  unprojectPoint,
  assertVector,
} from "./math";
import { metric, contextPlane, signedArea } from "./sketch-common";
import { validateGeometry, type ValidationContext } from "./validate";
import { prepareSketch } from "./sketch";

/** Canonical face loops expressed in a physical orthonormal world plane. */
export function offsetSource(
  model: GeometryModel,
  faceId: string,
  context: ValidationContext,
) {
  const face = model.faces[faceId];
  if (!face)
    throw new GeometryError(
      "INVALID_TOPOLOGY",
      "Грань для Offset не найдена.",
      [faceId],
    );
  const { world, local, tolerance } = metric(model, context),
    plane = contextPlane(face.plane, context);
  const rings = [face.outerLoopId, ...face.innerLoopIds].map((lid, index) => {
    const ring = model.loops[lid].coedgeIds.map((cid) => {
      const c = model.coedges[cid],
        e = model.edges[c.edgeId];
      return world(
        model.vertices[c.direction === 1 ? e.start : e.end].position,
      );
    });
    const points = ring.map((p) => projectPoint(p, plane));
    return signedArea(points) > 0 === (index === 0)
      ? ring
      : [...ring].reverse();
  });
  return { face, plane, rings, world, local, tolerance };
}
export function offsetReference(
  model: GeometryModel,
  faceId: string,
  point: Vec3,
  context: ValidationContext,
) {
  const source = offsetSource(model, faceId, context);
  let best = Infinity,
    inward: Vec3 | null = null;
  assertVector(point);
  for (const ring of source.rings)
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i],
        b = ring[(i + 1) % ring.length],
        d = subtract(b, a),
        size = length(d),
        t = Math.max(
          0,
          Math.min(1, dot(subtract(point, a), d) / (size * size)),
        ),
        dist = length(subtract(point, add(a, multiply(d, t))));
      if (dist < best) {
        best = dist;
        inward = cross(source.plane.normal, multiply(d, 1 / size));
      }
    }
  if (!inward)
    throw new GeometryError("INVALID_TOPOLOGY", "Нет контура для Offset.", [
      faceId,
    ]);
  return { plane: source.plane, inward, anchor: [...point] as Vec3 };
}
export interface FaceOffsetProfile {
  paths: Vec3[][];
  segments: [Vec3, Vec3][];
  plane: PlaneFrame;
  area: number;
  quantization: number;
}
/** Positive distance erodes face material (outer inward, holes outward).
 * Clipper resolves concave overlaps and disconnected regions on an integer
 * grid at least 32 times finer than GeometryPolicy, translated to the plane.
 */
export function faceOffsetProfile(
  model: GeometryModel,
  faceId: string,
  distance: number,
  context: ValidationContext,
): FaceOffsetProfile {
  const source = offsetSource(model, faceId, context),
    { plane, rings, tolerance, local } = source;
  if (
    !Number.isFinite(distance) ||
    Math.abs(distance) > 1e9 ||
    Math.abs(distance) <= tolerance
  )
    throw new GeometryError(
      "DEGENERATE",
      "Отступ должен быть больше геометрического допуска.",
      [faceId],
    );
  if (rings.reduce((n, p) => n + p.length, 0) > 256)
    throw new GeometryError(
      "RESOURCE_LIMIT",
      "Offset: не более 256 исходных рёбер.",
      [faceId],
    );
  const polygons = rings.map((r) => r.map((p) => projectPoint(p, plane))),
    scale = 2 ** Math.ceil(Math.log2(32 / tolerance));
  const extent = Math.max(
    Math.abs(distance) * 1000,
    ...polygons.flat().flat().map(Math.abs),
  );
  if (!Number.isFinite(scale) || extent * scale > 2 ** 50)
    throw new GeometryError(
      "NUMERICAL_AMBIGUITY",
      "Не хватает точности для Offset при этом размере модели и допуске.",
      [faceId],
    );
  for (const ring of polygons)
    for (let i = 0; i < ring.length; i++) {
      const a = ring[(i + ring.length - 1) % ring.length],
        b = ring[i],
        c = ring[(i + 1) % ring.length],
        u: [number, number] = [b[0] - a[0], b[1] - a[1]],
        v: [number, number] = [c[0] - b[0], c[1] - b[1]],
        cosine =
          (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v));
      if ((1 + cosine) / 2 < 1e-6)
        throw new GeometryError(
          "UNSUPPORTED_OPERATION",
          "Слишком острый угол для Offset с угловым соединением.",
          [faceId],
        );
    }
  let result: ReturnType<typeof inflatePaths>;
  try {
    result = inflatePaths(
      polygons.map((r) =>
        r.map((p) => ({
          x: Math.round(p[0] * scale),
          y: Math.round(p[1] * scale),
        })),
      ),
      -distance * scale,
      JoinType.Miter,
      EndType.Polygon,
      1000,
    );
  } catch {
    throw new GeometryError(
      "NUMERICAL_AMBIGUITY",
      "Не удалось устойчиво построить Offset.",
      [faceId],
    );
  }
  if (!result.length)
    throw new GeometryError(
      "DEGENERATE",
      "Offset полностью схлопнулся. Уменьшите отступ.",
      [faceId],
    );
  if (result.reduce((n, p) => n + p.length, 0) > 256)
    throw new GeometryError(
      "RESOURCE_LIMIT",
      "Offset создаёт больше 256 рёбер.",
      [faceId],
    );
  // Clipping determines topology on the bounded integer grid. Refit a
  // resulting corner to its original double-precision parallel lines when
  // the correction is strictly below policy tolerance. This keeps exact
  // decimal offsets (eg 200 mm rectangles) instead of retaining grid noise.
  const lines = polygons.flatMap((r) =>
    r.map((a, i) => {
      const b = r[(i + 1) % r.length],
        dx = b[0] - a[0],
        dy = b[1] - a[1],
        size = Math.hypot(dx, dy),
        direction: Vec2 = [dx / size, dy / size],
        normal: Vec2 = [-dy / size, dx / size];
      return {
        point: [
          a[0] + normal[0] * distance,
          a[1] + normal[1] * distance,
        ] as Vec2,
        direction,
        normal,
      };
    }),
  );
  const refine = (p: Vec2): Vec2 => {
    const candidates = lines.filter(
      (l) =>
        Math.abs(
          (p[0] - l.point[0]) * l.normal[0] + (p[1] - l.point[1]) * l.normal[1],
        ) <
        tolerance / 8,
    );
    let best = p,
      stability = 0;
    for (let i = 0; i < candidates.length; i++)
      for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i],
          b = candidates[j],
          det =
            a.direction[0] * b.direction[1] - a.direction[1] * b.direction[0];
        if (Math.abs(det) <= Math.max(1e-8, stability)) continue;
        const delta: Vec2 = [b.point[0] - a.point[0], b.point[1] - a.point[1]],
          t = (delta[0] * b.direction[1] - delta[1] * b.direction[0]) / det,
          q: Vec2 = [
            a.point[0] + t * a.direction[0],
            a.point[1] + t * a.direction[1],
          ];
        if (Math.hypot(q[0] - p[0], q[1] - p[1]) <= tolerance / 8) {
          best = q;
          stability = Math.abs(det);
        }
      }
    return best;
  };
  const points: Vec2[][] = result.map((r) =>
    r.map((p) => refine([p.x / scale, p.y / scale])),
  );
  if (
    points.some(
      (r) => r.length < 3 || Math.abs(signedArea(r)) <= tolerance * tolerance,
    )
  )
    throw new GeometryError(
      "DEGENERATE",
      "Offset создаёт вырожденную область.",
      [faceId],
    );
  const area = points.reduce((n, p) => n + signedArea(p), 0);
  if (!(area > tolerance * tolerance))
    throw new GeometryError("DEGENERATE", "Offset не образует область.", [
      faceId,
    ]);
  const paths = points.map((r) =>
      r.map((p) => {
        const q = unprojectPoint(p, plane);
        assertVector(q);
        return q;
      }),
    ),
    segments: [Vec3, Vec3][] = [];
  for (const path of paths)
    for (let i = 0; i < path.length; i++) {
      const a = path[i],
        b = path[(i + 1) % path.length];
      if (length(subtract(a, b)) <= tolerance)
        throw new GeometryError(
          "DEGENERATE",
          "Ребро Offset меньше допуска. Измените отступ.",
          [faceId],
        );
      segments.push([local(a), local(b)]);
    }
  return {
    paths,
    segments,
    plane: source.face.plane,
    area,
    quantization: 1 / scale,
  };
}
export function prepareFaceOffset(
  model: GeometryModel,
  faceId: string,
  distance: number,
  context: ValidationContext,
  operationId: Id<"operation">,
) {
  validateGeometry(model, context);
  const profile = faceOffsetProfile(model, faceId, distance, context);
  return prepareSketch(
    model,
    {
      kind: "insert-segments",
      segments: profile.segments,
      plane: profile.plane,
    },
    context,
    operationId,
  );
}
