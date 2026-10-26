import {
  GeometryError,
  createIdAllocator,
  entityTables,
  type GeometryModel,
  type Face,
  type Id,
  type Vec3,
  type PlaneFrame,
} from "./model";
import {
  add,
  subtract,
  multiply,
  cross,
  dot,
  length,
  distanceTolerance,
  projectPoint,
} from "./math";
import { identityMatrix, inverseAffine, type AffineTransform } from "./affine";
import {
  canonical,
  validateGeometry,
  classifyBody,
  type ValidationContext,
} from "./validate";
import {
  diffGeometry,
  invertDelta,
  type PreparedGeometryChange,
} from "./transactions";
import { contextPlane, metric, inRegion } from "./sketch-common";
import { segmentIntersections } from "./intersections";
import { tessellateFace } from "./tessellate";
const unit = (p: Vec3) => multiply(p, 1 / length(p));
export const linear = (v: Vec3, m: AffineTransform): Vec3 => [
  m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
  m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
  m[2] * v[0] + m[6] * v[1] + m[10] * v[2],
];
export function bodyVolume(
  m: GeometryModel,
  bodyId: string,
  matrix: AffineTransform = identityMatrix(),
): number | null {
  if (classifyBody(m, bodyId) !== "closed-shell") return null;
  const body = m.bodies[bodyId],
    origin = m.vertices[body.vertexIds[0]].position;
  let volume = 0;
  const orientedFaces = body.shellIds.length
    ? body.shellIds.flatMap((sid) => m.shells[sid].faces)
    : body.faceIds.map((faceId) => ({ faceId, orientation: 1 as const }));
  for (const use of orientedFaces) {
    const dto = tessellateFace(m, m.faces[use.faceId]);
    for (let i = 0; i < dto.indices.length; i += 3) {
      const [a, b, c] = dto.indices
        .slice(i, i + 3)
        .map((j) => linear(subtract(dto.positions[j], origin), matrix));
      volume += (use.orientation * dot(a, cross(b, c))) / 6;
    }
  }
  return Math.abs(volume);
}
const uses = (m: GeometryModel, f: Face) =>
  [f.outerLoopId, ...f.innerLoopIds].flatMap((l) =>
    m.loops[l].coedgeIds.map((c) => m.coedges[c]),
  );
function onSegment(p: Vec3, a: Vec3, b: Vec3, tolerance: number) {
  const d = subtract(b, a),
    n = dot(d, d),
    t = n ? Math.max(0, Math.min(1, dot(subtract(p, a), d) / n)) : 0;
  return length(subtract(p, add(a, multiply(d, t)))) <= tolerance;
}
// Confirm contacts against the common *topological* boundary. Screen-space
// overlaps never certify geometry, nor do disconnected touching shells weld.
export function assertFaceContacts(
  m: GeometryModel,
  changed: ReadonlySet<string>,
  context: ValidationContext,
) {
  const { world } = metric(m, context),
    all = Object.values(m.vertices).map((v) => world(v.position));
  const extent = all.length
    ? Math.hypot(
        ...[0, 1, 2].map(
          (i) =>
            all.reduce((a, p) => Math.max(a, p[i]), -Infinity) -
            all.reduce((a, p) => Math.min(a, p[i]), Infinity),
        ),
      )
    : 0;
  const tolerance = distanceTolerance(extent, context.policy),
    faces = Object.values(m.faces).map((f) => {
      const rings = [f.outerLoopId, ...f.innerLoopIds].map((l) =>
        m.loops[l].coedgeIds.map((cid) => {
          const c = m.coedges[cid],
            e = m.edges[c.edgeId];
          return c.direction === 1 ? e.start : e.end;
        }),
      );
      const vertices = rings.flat(),
        points = vertices.map((v) => world(m.vertices[v].position)),
        plane = contextPlane(f.plane, context);
      const edges = uses(m, f).map((c) => c.edgeId),
        polygons = rings.map((r) =>
          r.map((v) => projectPoint(world(m.vertices[v].position), plane)),
        );
      return {
        f,
        vertices,
        points,
        plane,
        edges,
        polygons,
        min: [0, 1, 2].map((i) => Math.min(...points.map((p) => p[i]))),
        max: [0, 1, 2].map((i) => Math.max(...points.map((p) => p[i]))),
      };
    });
  let pairs = 0;
  for (let i = 0; i < faces.length; i++)
    for (let j = i + 1; j < faces.length; j++) {
      const a = faces[i],
        b = faces[j];
      if (!changed.has(a.f.id) && !changed.has(b.f.id)) continue;
      if (++pairs > 200000)
        throw new GeometryError(
          "INVALID_TOPOLOGY",
          "Слишком сложная модель для проверки пересечений объёма.",
        );
      if (
        [0, 1, 2].some(
          (k) =>
            a.max[k] < b.min[k] - tolerance || b.max[k] < a.min[k] - tolerance,
        )
      )
        continue;
      const sharedVertices = a.vertices.filter((v) => b.vertices.includes(v)),
        sharedEdges = a.edges.filter((e) => b.edges.includes(e));
      const allowed = (p: Vec3) =>
        sharedVertices.some(
          (v) =>
            length(subtract(p, world(m.vertices[v].position))) <= tolerance,
        ) ||
        sharedEdges.some((e) =>
          onSegment(
            p,
            world(m.vertices[m.edges[e].start].position),
            world(m.vertices[m.edges[e].end].position),
            tolerance,
          ),
        );
      const contains = (p: Vec3, face: typeof a) =>
        face.edges.some((e) =>
          onSegment(
            p,
            world(m.vertices[m.edges[e].start].position),
            world(m.vertices[m.edges[e].end].position),
            tolerance,
          ),
        ) ||
        inRegion(
          projectPoint(p, face.plane),
          face.polygons[0],
          face.polygons.slice(1),
        );
      const check = (from: typeof a, to: typeof a) => {
        for (const eid of from.edges) {
          const e = m.edges[eid],
            p = world(m.vertices[e.start].position),
            q = world(m.vertices[e.end].position),
            dp = dot(subtract(p, to.plane.origin), to.plane.normal),
            dq = dot(subtract(q, to.plane.origin), to.plane.normal);
          const hit = (point: Vec3) => {
            if (contains(point, to) && !allowed(point))
              throw new GeometryError(
                "INVALID_TOPOLOGY",
                "Выдавливание пересекает другую грань. Уменьшите расстояние или разделите геометрию на группы.",
                [from.f.id, to.f.id],
              );
          };
          if (Math.abs(dp) <= tolerance && Math.abs(dq) <= tolerance) {
            hit(p);
            hit(q);
            hit(multiply(add(p, q), 0.5));
            for (const other of to.edges) {
              const edge = m.edges[other];
              for (const result of segmentIntersections(
                p,
                q,
                world(m.vertices[edge.start].position),
                world(m.vertices[edge.end].position),
                tolerance,
              ))
                hit(result.point);
            }
          } else if (
            (dp <= tolerance && dq >= -tolerance) ||
            (dq <= tolerance && dp >= -tolerance)
          ) {
            const t = dp / (dp - dq);
            if (t >= 0 && t <= 1) hit(add(p, multiply(subtract(q, p), t)));
          }
        }
      };
      check(a, b);
      check(b, a);
    }
}
export function prepareExtrusion(
  before: GeometryModel,
  faceId: string,
  distance: number,
  side: 1 | -1,
  context: ValidationContext,
  operationId: Id<"operation">,
): PreparedGeometryChange {
  validateGeometry(before, context);
  if (
    !Number.isFinite(distance) ||
    Math.abs(distance) > 1e6 ||
    Math.abs(distance) <= distanceTolerance(0, context.policy) ||
    ![1, -1].includes(side)
  )
    throw new GeometryError(
      "INVALID_TOPOLOGY",
      "Высота должна быть ненулевой и находиться в пределах ±1000000 м.",
    );
  const f = before.faces[faceId];
  if (!f)
    throw new GeometryError("INVALID_TOPOLOGY", "Выберите существующую грань.");
  const body = Object.values(before.bodies).find((b) =>
    b.faceIds.includes(f.id),
  );
  if (!body)
    throw new GeometryError("INVALID_TOPOLOGY", "Грань не принадлежит телу.");
  const m = structuredClone(before),
    worldPlane = contextPlane(f.plane, context),
    worldVector = multiply(worldPlane.normal, distance * side);
  const localVector = context.worldTransform
    ? linear(worldVector, inverseAffine(context.worldTransform))
    : worldVector;
  if (context.placement && !context.worldTransform)
    throw new GeometryError(
      "INVALID_TOPOLOGY",
      "Для объёма требуется полный affine контекст.",
    );
  const selected = uses(before, f),
    vertices = [
      ...new Set(
        selected.flatMap((c) => {
          const e = before.edges[c.edgeId];
          return [e.start, e.end];
        }),
      ),
    ];
  if (vertices.length > 128)
    throw new GeometryError(
      "INVALID_TOPOLOGY",
      "В этом этапе допускается не больше 128 вершин контура выдавливания.",
    );
  const changed = new Set<string>();
  const closed = classifyBody(before, body.id) === "closed-shell";
  const orientation =
    body.shellIds
      .flatMap((s) => before.shells[s].faces)
      .find((u) => u.faceId === f.id)?.orientation ?? 1;
  if (closed) {
    // Offset a prismatic cap without changing its IDs. All incident faces must
    // remain in their original planes; inversion/collision is checked below.
    const incident = body.faceIds.filter((id) =>
      uses(before, before.faces[id]).some((c) => {
        const e = before.edges[c.edgeId];
        return vertices.includes(e.start) || vertices.includes(e.end);
      }),
    );
    const candidate = structuredClone(m);
    vertices.forEach(
      (v) =>
        (candidate.vertices[v].position = add(
          candidate.vertices[v].position,
          localVector,
        )),
    );
    candidate.faces[f.id].plane.origin = add(
      candidate.faces[f.id].plane.origin,
      localVector,
    );
    let planar = true;
    for (const id of incident)
      if (id !== f.id) {
        const face = candidate.faces[id];
        if (
          uses(candidate, face).some((c) => {
            const e = candidate.edges[c.edgeId];
            return [e.start, e.end].some(
              (v) =>
                Math.abs(
                  dot(
                    subtract(candidate.vertices[v].position, face.plane.origin),
                    face.plane.normal,
                  ),
                ) > distanceTolerance(0, context.policy),
            );
          })
        )
          planar = false;
      }
    if (planar) {
      validateGeometry(candidate, context);
      incident.forEach((id) => changed.add(id));
      assertFaceContacts(candidate, changed, context);
      const volume = bodyVolume(candidate, body.id, context.worldTransform);
      if (volume === null || volume <= 0)
        throw new GeometryError(
          "INVALID_TOPOLOGY",
          "Выдавливание вырождает тело.",
        );
      const forward = diffGeometry(before, candidate);
      return { forward, inverse: invertDelta(forward), lineage: [] };
    }
  }
  const reserved = new Set([
    ...(context.reservedIds ?? []),
    before.id,
    before.ownerDefinitionId,
    ...entityTables.flatMap((t) => Object.keys(before[t])),
  ]);
  const allocate = createIdAllocator(operationId, reserved),
    topVertices = new Map<string, Id<"vertex">>(),
    topEdges = new Map<string, Id<"edge">>();
  for (const v of vertices) {
    const id = allocate("vertex");
    topVertices.set(v, id);
    m.vertices[id] = {
      ...structuredClone(m.vertices[v]),
      id,
      position: add(m.vertices[v].position, localVector),
    };
  }
  for (const c of selected) {
    if (topEdges.has(c.edgeId)) continue;
    const e = m.edges[c.edgeId],
      id = allocate("edge");
    topEdges.set(e.id, id);
    m.edges[id] = {
      ...structuredClone(e),
      id,
      start: topVertices.get(e.start)!,
      end: topVertices.get(e.end)!,
    };
  }
  const vertical = new Map<string, Id<"edge">>();
  for (const v of vertices) {
    const id = allocate("edge");
    vertical.set(v, id);
    m.edges[id] = {
      id,
      start: idVertex(v),
      end: topVertices.get(v)!,
      curve: { kind: "line" },
    };
  }
  function idVertex(v: string) {
    return before.vertices[v].id;
  }
  const newFaces: Id<"face">[] = [];
  function addFace(
    rings: { edgeId: Id<"edge">; direction: 1 | -1 }[][],
    plane: PlaneFrame,
  ) {
    const id = allocate("face"),
      loops = rings.map((r) => {
        const lid = allocate("loop"),
          coedgeIds = r.map((use) => {
            const cid = allocate("coedge");
            m.coedges[cid] = { id: cid, ...use, loopId: lid };
            return cid;
          });
        m.loops[lid] = { id: lid, coedgeIds };
        return lid;
      });
    m.faces[id] = {
      ...structuredClone(f),
      id,
      plane: structuredClone(plane),
      outerLoopId: loops[0],
      innerLoopIds: loops.slice(1),
    };
    newFaces.push(id);
    return id;
  }
  if (!m.bodies[body.id].shellIds.length) {
    const sid = allocate("shell");
    m.shells[sid] = {
      id: sid,
      faces: body.faceIds.map((faceId) => ({ faceId, orientation: 1 })),
    };
    m.bodies[body.id].shellIds = [sid];
  }
  const s = Math.sign(distance * side) as 1 | -1,
    shell = m.shells[m.bodies[body.id].shellIds[0]];
  if (!shell || m.bodies[body.id].shellIds.length !== 1)
    throw new GeometryError(
      "INVALID_TOPOLOGY",
      "Выдавливание нескольких оболочек пока не поддерживается.",
    );
  if (body.faceIds.length === 1) {
    if (body.edgeIds.length !== new Set(selected.map((c) => c.edgeId)).size)
      throw new GeometryError(
        "INVALID_TOPOLOGY",
        "Отделите вспомогательные рёбра от контура.",
      );
    const bottom = addFace(
      [f.outerLoopId, ...f.innerLoopIds].map((l) =>
        before.loops[l].coedgeIds.map((c) => ({
          edgeId: before.coedges[c].edgeId,
          direction: before.coedges[c].direction,
        })),
      ),
      f.plane,
    );
    shell.faces.push({ faceId: bottom, orientation: -s as 1 | -1 });
  }
  for (const c of selected) {
    const e = before.edges[c.edgeId],
      a = c.direction === 1 ? e.start : e.end,
      b = c.direction === 1 ? e.end : e.start;
    const u = unit(
        subtract(before.vertices[b].position, before.vertices[a].position),
      ),
      normal = unit(cross(u, localVector)),
      v = cross(normal, u);
    const sideFace = addFace(
      [
        [
          { edgeId: e.id, direction: c.direction },
          { edgeId: vertical.get(b)!, direction: 1 },
          { edgeId: topEdges.get(e.id)!, direction: -c.direction as 1 | -1 },
          { edgeId: vertical.get(a)!, direction: -1 },
        ],
      ],
      { origin: before.vertices[a].position, u, v, normal },
    );
    shell.faces.push({
      faceId: sideFace,
      orientation: body.faceIds.length === 1 ? s : orientation,
    });
  }
  for (const c of selected) m.coedges[c.id].edgeId = topEdges.get(c.edgeId)!;
  m.faces[f.id].plane.origin = add(m.faces[f.id].plane.origin, localVector);
  changed.add(f.id);
  newFaces.forEach((f) => changed.add(f));
  shell.faces.find((u) => u.faceId === f.id)!.orientation =
    body.faceIds.length === 1 ? s : orientation;
  const target = m.bodies[body.id];
  target.vertexIds.push(...topVertices.values());
  target.edgeIds.push(...topEdges.values(), ...vertical.values());
  target.faceIds.push(...newFaces);
  validateGeometry(m, context);
  assertFaceContacts(m, changed, context);
  if (body.faceIds.length === 1 && classifyBody(m, body.id) !== "closed-shell")
    throw new GeometryError(
      "INVALID_TOPOLOGY",
      "Не удалось замкнуть оболочку объёма.",
    );
  const forward = diffGeometry(before, m);
  if (canonical(before) === canonical(m))
    throw new GeometryError(
      "INVALID_TOPOLOGY",
      "Операция не изменила геометрию.",
    );
  return { forward, inverse: invertDelta(forward), lineage: [] };
}
