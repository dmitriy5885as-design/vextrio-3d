import {
  defaultPolicy,
  entityTables,
  GeometryError,
  id,
  type GeometryModel,
  type GeometryPolicy,
  type PlaneFrame,
  type Vec2,
  type Vec3,
} from "./model";
import {
  assertVector,
  distanceTolerance,
  dot,
  length,
  projectPoint,
  subtract,
  validatePlane,
  localToWorld,
  transformPlane,
  validateTransform,
  type PlacementTransform,
} from "./math";
import { inside, orientation, segmentsTouch } from "./predicates";
import {
  validateAffine,
  transformAffine,
  affinePlane,
  type AffineTransform,
} from "./affine";
export interface ValidationContext {
  ownerDefinitionId: string;
  materialIds: ReadonlySet<string>;
  reservedIds?: ReadonlySet<string>;
  policy?: GeometryPolicy;
  // One placement at this boundary; full occurrence-path composition is S4/S5.
  placement?: PlacementTransform;
  worldTransform?: AffineTransform;
}
function fail(message: string, refs: string[] = []): never {
  throw new GeometryError("INVALID_TOPOLOGY", message, refs);
}
export function canonical(value: unknown): string {
  let count = 0;
  const active = new Set<object>();
  function visit(v: unknown, depth: number): string {
    if (++count > 200000 || depth > 40)
      throw new GeometryError(
        "RESOURCE_LIMIT",
        "Geometry payload exceeds validation budget",
      );
    if (v === null || typeof v === "string" || typeof v === "boolean")
      return JSON.stringify(v);
    if (typeof v === "number" && Number.isFinite(v)) return JSON.stringify(v);
    if (typeof v !== "object" || v === null || active.has(v))
      return fail("Geometry must be acyclic JSON data");
    const array = Array.isArray(v);
    if (
      Object.getPrototypeOf(v) !==
        (array ? Array.prototype : Object.prototype) &&
      Object.getPrototypeOf(v) !== null
    )
      return fail("Non-plain geometry data");
    active.add(v);
    const keys = Reflect.ownKeys(v).filter((k) => !(array && k === "length"));
    if (keys.some((k) => typeof k !== "string"))
      return fail("Symbol geometry key");
    const values = new Map<string, unknown>();
    for (const k of keys as string[]) {
      const d = Object.getOwnPropertyDescriptor(v, k)!;
      if (!("value" in d) || !d.enumerable) return fail("Geometry accessor");
      values.set(k, d.value);
    }
    let result: string;
    if (array) {
      if (
        keys.length !== v.length ||
        keys.some(
          (k) => !/^(0|[1-9]\d*)$/.test(String(k)) || Number(k) >= v.length,
        )
      )
        return fail("Sparse geometry array");
      result =
        "[" +
        Array.from({ length: v.length }, (_, i) =>
          visit(values.get(String(i)), depth + 1),
        ).join(",") +
        "]";
    } else
      result =
        "{" +
        [...values.keys()]
          .sort()
          .map((k) => JSON.stringify(k) + ":" + visit(values.get(k), depth + 1))
          .join(",") +
        "}";
    active.delete(v);
    return result;
  }
  return visit(value, 0);
}
function unique(values: string[], label: string) {
  if (
    !Array.isArray(values) ||
    values.some((v) => typeof v !== "string") ||
    new Set(values).size !== values.length
  )
    fail("Duplicate/invalid " + label);
}
export function validateGeometry(
  model: GeometryModel,
  context: ValidationContext,
): void {
  try {
    validate(model, context);
  } catch (error) {
    if (error instanceof GeometryError) throw error;
    throw new GeometryError("INVALID_TOPOLOGY", "Malformed topology payload");
  }
}
function validate(m: GeometryModel, c: ValidationContext) {
  canonical(m);
  const policy = c.policy ?? defaultPolicy;
  id(m.id);
  id(m.ownerDefinitionId);
  if (
    m.representation !== "planar-topology" ||
    m.ownerDefinitionId !== c.ownerDefinitionId ||
    String(m.id) === String(m.ownerDefinitionId)
  )
    fail("Geometry ownership mismatch");
  if (c.materialIds.has(m.id) || c.materialIds.has(m.ownerDefinitionId))
    fail("Material/context ID collision");
  const all = new Set<string>([m.id, m.ownerDefinitionId, ...c.materialIds]);
  let total = 0;
  for (const table of entityTables) {
    const entries = Object.entries(m[table]);
    if (
      Array.isArray(m[table]) ||
      entries.length > 10000 ||
      (total += entries.length) > 20000
    )
      throw new GeometryError(
        "RESOURCE_LIMIT",
        "Topology entity limit exceeded",
      );
    for (const [key, entity] of entries) {
      id(key);
      if (entity.id !== key || all.has(key) || c.reservedIds?.has(key))
        fail("Duplicate or mismatched entity ID", [key]);
      all.add(key);
    }
  }
  const vertices = Object.values(m.vertices),
    min: Vec3 = [Infinity, Infinity, Infinity],
    max: Vec3 = [-Infinity, -Infinity, -Infinity];
  if (c.placement) validateTransform(c.placement, policy);
  if (c.worldTransform) validateAffine(c.worldTransform, policy);
  const worldPositions = new Map<string, Vec3>();
  for (const vertex of vertices) {
    assertVector(vertex.position);
    if (vertex.role !== undefined && vertex.role !== "construction")
      fail("Invalid vertex role");
    const point = c.worldTransform
      ? transformAffine(vertex.position, c.worldTransform)
      : c.placement
        ? localToWorld(vertex.position, c.placement)
        : vertex.position;
    worldPositions.set(vertex.id, point);
    point.forEach((n, i) => {
      min[i] = Math.min(min[i], n);
      max[i] = Math.max(max[i], n);
    });
  }
  const tolerance = distanceTolerance(
    vertices.length ? length(subtract(max, min)) : 0,
    policy,
  );
  const edgeUse = new Map<string, string[]>(),
    vertexEdges = new Map<string, string[]>();
  for (const e of Object.values(m.edges)) {
    if (
      !m.vertices[e.start] ||
      !m.vertices[e.end] ||
      e.start === e.end ||
      e.curve.kind !== "line"
    )
      fail("Invalid edge endpoints", [e.id]);
    if (
      length(
        subtract(worldPositions.get(e.start)!, worldPositions.get(e.end)!),
      ) <= tolerance
    )
      throw new GeometryError("DEGENERATE", "Zero/short edge", [e.id]);
    for (const v of [e.start, e.end])
      vertexEdges.set(v, [...(vertexEdges.get(v) ?? []), e.id]);
    edgeUse.set(e.id, []);
  }
  for (const v of vertices)
    if (!vertexEdges.has(v.id) && v.role !== "construction")
      fail("Orphan vertex", [v.id]);
  const coedgeOwners = new Set<string>(),
    loopOwners = new Set<string>(),
    loopVertices = new Map<string, string[]>();
  for (const loop of Object.values(m.loops)) {
    unique(loop.coedgeIds, "coedge use");
    if (loop.coedgeIds.length < 3 || loop.coedgeIds.length > 512)
      throw new GeometryError(
        "RESOURCE_LIMIT",
        "Loop must contain 3..512 coedges",
        [loop.id],
      );
    const starts: string[] = [],
      ends: string[] = [],
      edges = new Set<string>();
    for (const cid of loop.coedgeIds) {
      const co = m.coedges[cid];
      if (
        !co ||
        co.loopId !== loop.id ||
        coedgeOwners.has(cid) ||
        ![1, -1].includes(co.direction) ||
        !m.edges[co.edgeId] ||
        edges.has(co.edgeId)
      )
        fail("Invalid oriented edge use", [cid]);
      edges.add(co.edgeId);
      coedgeOwners.add(cid);
      const e = m.edges[co.edgeId];
      starts.push(co.direction === 1 ? e.start : e.end);
      ends.push(co.direction === 1 ? e.end : e.start);
      edgeUse.get(e.id)!.push(loop.id);
    }
    unique(starts, "loop vertex");
    if (ends.some((v, i) => v !== starts[(i + 1) % starts.length]))
      fail("Open/disordered contour", [loop.id]);
    loopVertices.set(loop.id, starts);
  }
  if (coedgeOwners.size !== Object.keys(m.coedges).length)
    fail("Orphan coedge");
  const faceEdges = new Map<string, Set<string>>();
  let intersectionChecks = 0;
  const touch = (a: Vec2, b: Vec2, c: Vec2, d: Vec2) => {
    if (++intersectionChecks > 1_000_000)
      throw new GeometryError(
        "RESOURCE_LIMIT",
        "Contour validation budget exceeded",
      );
    return segmentsTouch(a, b, c, d);
  };
  function polygon(loopId: string, plane: PlaneFrame, winding: 1 | -1): Vec2[] {
    if (loopOwners.has(loopId) || !loopVertices.has(loopId))
      fail("Missing/shared loop", [loopId]);
    loopOwners.add(loopId);
    const points = loopVertices.get(loopId)!.map((v) => worldPositions.get(v)!);
    if (
      points.some(
        (p) =>
          Math.abs(dot(subtract(p, plane.origin), plane.normal)) > tolerance,
      )
    )
      throw new GeometryError("NON_PLANAR", "Contour leaves face plane", [
        loopId,
      ]);
    const projected = points.map((p) => projectPoint(p, plane));
    for (let i = 0; i < projected.length; i++) {
      if (
        orientation(
          projected[(i + projected.length - 1) % projected.length],
          projected[i],
          projected[(i + 1) % projected.length],
        ) === 0 &&
        dot(
          subtract(points[(i + points.length - 1) % points.length], points[i]),
          subtract(points[(i + 1) % points.length], points[i]),
        ) >= 0
      )
        throw new GeometryError("DEGENERATE", "Collinear contour corner", [
          loopId,
        ]);
      for (let j = i + 1; j < projected.length; j++)
        if (
          j !== i + 1 &&
          !(i === 0 && j === projected.length - 1) &&
          touch(
            projected[i],
            projected[(i + 1) % projected.length],
            projected[j],
            projected[(j + 1) % projected.length],
          )
        )
          fail("Self-intersecting contour", [loopId]);
    }
    const origin = projected[0];
    let area = 0;
    for (let i = 1; i < projected.length - 1; i++)
      area +=
        (projected[i][0] - origin[0]) * (projected[i + 1][1] - origin[1]) -
        (projected[i][1] - origin[1]) * (projected[i + 1][0] - origin[0]);
    if (Math.abs(area) <= 2 * tolerance * tolerance)
      throw new GeometryError("DEGENERATE", "Contour area below tolerance", [
        loopId,
      ]);
    if (Math.sign(area) !== winding)
      fail("Incorrect contour winding", [loopId]);
    return projected;
  }
  const loopFace = new Map<string, string>();
  for (const f of Object.values(m.faces)) {
    validatePlane(f.plane, policy);
    const metricPlane = c.worldTransform
      ? affinePlane(f.plane, c.worldTransform)
      : c.placement
        ? transformPlane(f.plane, c.placement)
        : f.plane;
    if (
      !c.materialIds.has(f.frontMaterialId) ||
      !c.materialIds.has(f.backMaterialId)
    )
      fail("Unknown face material", [f.id]);
    unique([f.outerLoopId, ...f.innerLoopIds], "face loop");
    const loops = [f.outerLoopId, ...f.innerLoopIds],
      polygons = loops.map((l, i) => polygon(l, metricPlane, i === 0 ? 1 : -1));
    const edges = new Set<string>();
    for (const lid of loops) {
      loopFace.set(lid, f.id);
      for (const co of m.loops[lid].coedgeIds) edges.add(m.coedges[co].edgeId);
    }
    faceEdges.set(f.id, edges);
    for (let i = 1; i < polygons.length; i++)
      if (!inside(polygons[i][0], polygons[0]))
        fail("Hole outside face", [f.id]);
    for (let i = 0; i < polygons.length; i++)
      for (let j = i + 1; j < polygons.length; j++) {
        const a = polygons[i],
          b = polygons[j];
        for (let x = 0; x < a.length; x++)
          for (let y = 0; y < b.length; y++)
            if (touch(a[x], a[(x + 1) % a.length], b[y], b[(y + 1) % b.length]))
              fail("Touching/intersecting face boundaries", [f.id]);
        if (i > 0 && (inside(a[0], b) || inside(b[0], a)))
          fail("Nested/overlapping holes", [f.id]);
      }
  }
  if (loopOwners.size !== Object.keys(m.loops).length) fail("Orphan loop");
  function connected(
    ids: string[],
    neighbors: (id: string) => Iterable<string>,
  ) {
    if (!ids.length) return false;
    const allowed = new Set(ids),
      seen = new Set<string>(),
      queue = [ids[0]];
    for (let i = 0; i < queue.length; i++) {
      const v = queue[i];
      if (seen.has(v)) continue;
      seen.add(v);
      for (const n of neighbors(v))
        if (allowed.has(n) && !seen.has(n)) queue.push(n);
    }
    return seen.size === allowed.size;
  }
  const shellOwner = new Set<string>();
  for (const s of Object.values(m.shells)) {
    const faces = s.faces.map((f) => f.faceId);
    unique(faces, "shell face");
    if (
      s.faces.some(
        (f) =>
          !m.faces[f.faceId] ||
          ![1, -1].includes(f.orientation) ||
          shellOwner.has(f.faceId),
      )
    )
      fail("Invalid shell face use", [s.id]);
    faces.forEach((f) => shellOwner.add(f));
    if (
      !connected(faces, (f) =>
        [...faceEdges.get(f)!].flatMap((e) =>
          edgeUse.get(e)!.map((l) => loopFace.get(l)!),
        ),
      )
    )
      fail("Disconnected shell", [s.id]);
  }
  const owned = new Set<string>();
  for (const b of Object.values(m.bodies)) {
    const sets = [b.vertexIds, b.edgeIds, b.faceIds, b.shellIds],
      tables = [m.vertices, m.edges, m.faces, m.shells];
    sets.forEach((list, i) => {
      unique(list, "body membership");
      for (const key of list) {
        if (!Object.hasOwn(tables[i], key) || owned.has(key))
          fail("Missing/shared body member", [key]);
        owned.add(key);
      }
    });
    const requiredVertices = new Set(
      b.edgeIds.flatMap((e) => [m.edges[e].start, m.edges[e].end]),
    );
    if (
      requiredVertices.size !== b.vertexIds.length ||
      b.vertexIds.some((v) => !requiredVertices.has(v))
    )
      fail("Body vertex closure mismatch", [b.id]);
    if (
      b.faceIds.some((f) =>
        [...faceEdges.get(f)!].some((e) => !b.edgeIds.includes(e as never)),
      ) ||
      b.shellIds.some((s) =>
        m.shells[s].faces.some((f) => !b.faceIds.includes(f.faceId)),
      )
    )
      fail("Body incidence mismatch", [b.id]);
    if (
      !connected(b.edgeIds, (e) => [
        ...[m.edges[e].start, m.edges[e].end].flatMap((v) =>
          vertexEdges.get(v)!,
        ),
        ...edgeUse
          .get(e)!
          .flatMap((l) => [...faceEdges.get(loopFace.get(l)!)!]),
      ])
    )
      fail("Disconnected body", [b.id]);
  }
  for (const table of [m.edges, m.faces, m.shells])
    for (const key of Object.keys(table))
      if (!owned.has(key)) fail("Entity missing body ownership", [key]);
}
// Topological classification only: closed-shell does not certify volume or
// absence of geometric self-intersections and must never be labelled solid.
export function classifyBody(
  m: GeometryModel,
  bodyId: string,
): "wire" | "sheet" | "closed-shell" | "non-manifold" {
  const b = m.bodies[bodyId];
  if (!b) return fail("Unknown body", [bodyId]);
  if (!b.faceIds.length) return "wire";
  const counts = new Map<string, number>(),
    directions = new Map<string, number>();
  for (const fid of b.faceIds) {
    const f = m.faces[fid];
    const shellOrientation =
      b.shellIds.flatMap((s) => m.shells[s].faces).find((u) => u.faceId === fid)
        ?.orientation ?? 1;
    for (const lid of [f.outerLoopId, ...f.innerLoopIds])
      for (const cid of m.loops[lid].coedgeIds) {
        const co = m.coedges[cid];
        counts.set(co.edgeId, (counts.get(co.edgeId) ?? 0) + 1);
        directions.set(
          co.edgeId,
          (directions.get(co.edgeId) ?? 0) + co.direction * shellOrientation,
        );
      }
  }
  if ([...counts.values()].some((n) => n > 2)) return "non-manifold";
  // A disconnected face fan (bow-tie vertex) is non-manifold even if every
  // edge has at most two uses. Check the vertex link, not just edge valence.
  for (const vertexId of b.vertexIds) {
    const incident = b.edgeIds.filter(
      (e) => m.edges[e].start === vertexId || m.edges[e].end === vertexId,
    );
    const incidentFaces = new Set<string>(),
      edgeFaces = new Map<string, string[]>();
    for (const edgeId of incident) {
      const faces = b.faceIds.filter((fid) => {
        const f = m.faces[fid];
        return [f.outerLoopId, ...f.innerLoopIds].some((l) =>
          m.loops[l].coedgeIds.some((c) => m.coedges[c].edgeId === edgeId),
        );
      });
      edgeFaces.set(edgeId, faces);
      faces.forEach((f) => incidentFaces.add(f));
    }
    if (!incidentFaces.size) continue;
    const boundary = incident.filter((e) => counts.get(e) === 1).length;
    if (
      (boundary !== 0 && boundary !== 2) ||
      incident.some((e) => !counts.has(e))
    )
      return "non-manifold";
    const queue = [incidentFaces.values().next().value!],
      seen = new Set<string>();
    for (let i = 0; i < queue.length; i++) {
      const face = queue[i];
      if (seen.has(face)) continue;
      seen.add(face);
      for (const faces of edgeFaces.values())
        if (faces.includes(face))
          for (const next of faces) if (!seen.has(next)) queue.push(next);
    }
    if (seen.size !== incidentFaces.size) return "non-manifold";
  }
  return b.edgeIds.every((e) => counts.get(e) === 2 && directions.get(e) === 0)
    ? "closed-shell"
    : "sheet";
}
