import {
  GeometryError,
  entityTables,
  type Face,
  type GeometryModel,
  type Id,
  type Vec3,
} from "./model";
import { add, cross, dot, projectPoint, subtract } from "./math";
import { contextPlane, inRegion, metric, unit } from "./sketch-common";
import { planeCells, type Boundary } from "./arrangement";
import { splitSegments } from "./edge-builder";
import { loopVertices, onSegment, type ExtrusionStop } from "./through";
import { diffGeometry, type LineageEntry } from "./transactions";
import type { ValidationContext } from "./validate";

// Subtract a complete boundary-touching prism from a single shell. Existing
// planar arrangements split the back skin and boundary strips; no triangles
// are used to decide topology. The caller validates the complete candidate.
export function boundaryThrough(
  before: GeometryModel,
  source: Face,
  stop: ExtrusionStop,
  vector: Vec3,
  context: ValidationContext,
  operationId: Id<"operation">,
) {
  const body = Object.values(before.bodies).find((b) =>
    b.faceIds.includes(source.id),
  )!;
  if (body.shellIds.length !== 1)
    throw new GeometryError(
      "UNSUPPORTED_OPERATION",
      "Проём требует одну замкнутую оболочку.",
    );
  const shellBefore = before.shells[body.shellIds[0]],
    orientation = shellBefore.faces.find(
      (u) => u.faceId === source.id,
    )!.orientation,
    points = loopVertices(before, source.outerLoopId),
    top = points.map((p) => add(p, vector)),
    segments: [Vec3, Vec3][] = top.map((p, i) => [
      p,
      top[(i + 1) % top.length],
    ]);
  points.forEach((p, i) => segments.push([p, top[i]]));
  const split = splitSegments(before, segments, context, operationId),
    m = split.model,
    { world, tolerance: t } = metric(m, context),
    allocate = split.allocate,
    shell = m.shells[shellBefore.id];
  const removeFace = (fid: string) => {
    const f = m.faces[fid];
    for (const lid of [f.outerLoopId, ...f.innerLoopIds]) {
      for (const cid of m.loops[lid].coedgeIds) delete m.coedges[cid];
      delete m.loops[lid];
    }
    delete m.faces[fid];
    shell.faces = shell.faces.filter((u) => u.faceId !== fid);
  };
  const loop = (uses: Boundary["uses"]) => {
    const lid = allocate("loop");
    m.loops[lid] = {
      id: lid,
      coedgeIds: uses.map((use) => {
        const cid = allocate("coedge");
        m.coedges[cid] = { id: cid, loopId: lid, ...use };
        return cid;
      }),
    };
    return lid;
  };
  const cuts = new Map<string, Vec3[][]>([[stop.faceId, [top.map(world)]]]);
  for (const { edgeId, faceId } of stop.boundaryEdges!) {
    const e = before.edges[edgeId],
      a = before.vertices[e.start].position,
      b = before.vertices[e.end].position;
    const list = cuts.get(faceId) ?? [];
    list.push([a, b, add(b, vector), add(a, vector)].map(world));
    cuts.set(faceId, list);
  }
  for (const [fid, rings] of cuts) {
    const original = before.faces[fid],
      plane = contextPlane(original.plane, context),
      oldUse = shellBefore.faces.find((u) => u.faceId === fid)!;
    const polygons = rings.map((r) => r.map((p) => projectPoint(p, plane)));
    const originalRings = [original.outerLoopId, ...original.innerLoopIds].map(
      (l) => loopVertices(before, l).map((p) => projectPoint(world(p), plane)),
    );
    const cells = planeCells(m, plane, world, t).filter(
      (cell) =>
        inRegion(
          projectPoint(cell.sample, plane),
          originalRings[0],
          originalRings.slice(1),
        ) &&
        !polygons.some((poly) =>
          inRegion(projectPoint(cell.sample, plane), poly),
        ),
    );
    if (!cells.length)
      throw new GeometryError(
        "UNSUPPORTED_OPERATION",
        "Проём удаляет опорную грань целиком.",
      );
    removeFace(fid);
    cells.forEach((cell, i) => {
      const id = i === 0 ? original.id : allocate("face");
      m.faces[id] = {
        ...structuredClone(original),
        id,
        outerLoopId: loop(cell.outer.uses),
        innerLoopIds: cell.holes.map((h) =>
          loop(
            [...h.uses]
              .reverse()
              .map((u) => ({ ...u, direction: -u.direction as 1 | -1 })),
          ),
        ),
      };
      shell.faces.push({ faceId: id, orientation: oldUse.orientation });
    });
  }
  // Assemble each reveal from canonical split edges, including any collinear
  // vertices retained by the shared intersection engine.
  const path = (a: Vec3, b: Vec3): Boundary["uses"] => {
    const wa = world(a),
      wb = world(b),
      d = subtract(wb, wa),
      n = dot(d, d);
    const edges = Object.values(m.edges)
      .filter((e) =>
        [e.start, e.end].every((v) =>
          onSegment(world(m.vertices[v].position), wa, wb, t),
        ),
      )
      .map((e) => {
        const sa =
            dot(subtract(world(m.vertices[e.start].position), wa), d) / n,
          sb = dot(subtract(world(m.vertices[e.end].position), wa), d) / n;
        return { e, sa, sb, start: Math.min(sa, sb), end: Math.max(sa, sb) };
      })
      .sort((x, y) => x.start - y.start);
    let cursor = 0;
    const out: Boundary["uses"] = [];
    for (const e of edges) {
      if (Math.abs(e.start - cursor) * Math.sqrt(n) > t)
        throw new GeometryError("INVALID_TOPOLOGY", "Неполная граница откоса.");
      out.push({ edgeId: e.e.id, direction: e.sa < e.sb ? 1 : -1 });
      cursor = e.end;
    }
    if (Math.abs(cursor - 1) * Math.sqrt(n) > t)
      throw new GeometryError("INVALID_TOPOLOGY", "Откос не замкнут.");
    return out;
  };
  const boundary = new Set(stop.boundaryEdges!.map((e) => e.edgeId));
  const sourceUses = before.loops[source.outerLoopId].coedgeIds.map(
    (c) => before.coedges[c],
  );
  sourceUses.forEach((use, i) => {
    if (boundary.has(use.edgeId)) return;
    const a = points[i],
      b = points[(i + 1) % points.length],
      ta = top[i],
      tb = top[(i + 1) % points.length],
      u = unit(subtract(b, a)),
      normal = unit(cross(u, vector)),
      id = allocate("face");
    m.faces[id] = {
      ...structuredClone(source),
      id,
      plane: { origin: a, u, v: cross(normal, u), normal },
      outerLoopId: loop([
        ...path(a, b),
        ...path(b, tb),
        ...path(tb, ta),
        ...path(ta, a),
      ]),
      innerLoopIds: [],
    };
    shell.faces.push({ faceId: id, orientation });
  });
  removeFace(source.id);
  // Remove only unreferenced edges from this body and newly constructed atoms.
  // Unrelated wire bodies and construction vertices must remain untouched.
  const used = new Set(Object.values(m.coedges).map((c) => c.edgeId));
  const oldOtherEdges = new Set(
    Object.values(before.bodies)
      .filter((b) => b.id !== body.id)
      .flatMap((b) => b.edgeIds),
  );
  for (const e of Object.values(m.edges))
    if (!used.has(e.id) && !oldOtherEdges.has(e.id)) delete m.edges[e.id];
  const usedVertices = new Set(
    Object.values(m.edges).flatMap((e) => [e.start, e.end]),
  );
  for (const v of Object.values(m.vertices))
    if (!usedVertices.has(v.id) && v.role !== "construction")
      delete m.vertices[v.id];
  const target = m.bodies[body.id];
  target.faceIds = shell.faces.map((u) => u.faceId);
  target.edgeIds = [
    ...new Set(
      target.faceIds.flatMap((fid) => {
        const f = m.faces[fid];
        return [f.outerLoopId, ...f.innerLoopIds].flatMap((l) =>
          m.loops[l].coedgeIds.map((c) => m.coedges[c].edgeId),
        );
      }),
    ),
  ];
  target.vertexIds = [
    ...new Set(
      target.edgeIds.flatMap((e) => [m.edges[e].start, m.edges[e].end]),
    ),
  ];
  const delta = diffGeometry(before, m),
    lineage: LineageEntry[] = [];
  for (const table of entityTables)
    for (const p of delta[table])
      if (p.before && !p.after) {
        const inherited = split.lineage.find((l) => l.retiredId === p.id);
        const descendants =
          inherited?.descendants.filter((d) => !!m[table][d.id]) ?? [];
        lineage.push({
          operationId,
          kind: (
            {
              vertices: "vertex",
              edges: "edge",
              coedges: "coedge",
              loops: "loop",
              faces: "face",
              shells: "shell",
              bodies: "body",
            } as const
          )[table],
          retiredId: p.id,
          descendants,
          reason: descendants.length
            ? descendants.length > 1
              ? "split"
              : "convert"
            : "delete",
        });
      }
  return { model: m, lineage };
}
