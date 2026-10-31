import { contextPlane } from "./sketch-common";
import {
  createIdAllocator,
  entityTables,
  GeometryError,
  type GeometryModel,
  type Id,
  type Vec3,
} from "./model";
import { assertVector, dot, length, subtract, validatePlane } from "./math";
import { metric, near, onPlane } from "./sketch-common";
import { segmentIntersections } from "./intersections";
import type { ValidationContext } from "./validate";
import type { LineageEntry } from "./transactions";
export type Allocator = ReturnType<typeof createIdAllocator>;
export interface SplitResult {
  model: GeometryModel;
  lineage: LineageEntry[];
  allocate: Allocator;
  tolerance: number;
  world: (p: Vec3) => Vec3;
  local: (p: Vec3) => Vec3;
}
export function splitSegments(
  before: GeometryModel,
  segments: [Vec3, Vec3][],
  context: ValidationContext,
  operationId: Id<"operation">,
  plane: import("./model").PlaneFrame | null = null,
): SplitResult {
  if (!Array.isArray(segments) || segments.length > 256)
    throw new GeometryError(
      "RESOURCE_LIMIT",
      "At most 256 segments per operation",
    );
  for (const s of segments) {
    if (!Array.isArray(s) || s.length !== 2)
      throw new GeometryError("INVALID_TOPOLOGY", "Expected endpoint pair");
    s.forEach(assertVector);
  }
  if (plane) {
    validatePlane(plane, context.policy);
  }
  const model = structuredClone(before),
    { world, local, tolerance } = metric(model, context, segments.flat()),
    reserved = entityTables.flatMap((t) => Object.keys(model[t]));
  if (plane) {
    const metricPlane = contextPlane(plane, context);
    for (const p of segments.flat())
      if (!onPlane(world(p), metricPlane, tolerance))
        throw new GeometryError(
          "NON_PLANAR",
          "Input leaves its declared sketch plane",
        );
  }
  const allocate = createIdAllocator(operationId, [
    model.id,
    model.ownerDefinitionId,
    ...reserved,
    ...context.materialIds,
    ...(context.reservedIds ?? []),
  ]);
  const lineage: LineageEntry[] = [],
    aliases = new Map<string, Id<"vertex">>(),
    clusters: { id: Id<"vertex">; point: Vec3; members: Vec3[] }[] = [];
  function vertex(point: Vec3, existing?: Id<"vertex">): Id<"vertex"> {
    if (clusters.length >= 2048)
      throw new GeometryError(
        "RESOURCE_LIMIT",
        "Reference intersection engine vertex budget exceeded",
      );
    const matches = clusters.filter((c) => near(c.point, point, tolerance));
    if (
      matches.length > 1 ||
      matches.some((c) => c.members.some((p) => !near(p, point, tolerance)))
    )
      throw new GeometryError(
        "NUMERICAL_AMBIGUITY",
        "Non-transitive endpoint tolerance cluster",
      );
    if (matches.length) {
      matches[0].members.push(point);
      return matches[0].id;
    }
    const key = existing ?? allocate("vertex");
    if (!existing) model.vertices[key] = { id: key, position: local(point) };
    clusters.push({ id: key, point, members: [point] });
    return key;
  }
  for (const v of Object.values(model.vertices).sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    const key = vertex(world(v.position), v.id);
    aliases.set(v.id, key);
    if (key !== v.id) {
      delete model.vertices[v.id];
      lineage.push({
        operationId,
        kind: "vertex",
        retiredId: v.id,
        descendants: [{ id: key }],
        reason: "merge",
      });
    }
  }
  const sources = Object.values(before.edges)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((e) => ({
      old: e.id as Id<"edge"> | null,
      a: aliases.get(e.start)!,
      b: aliases.get(e.end)!,
      cuts: [] as { t: number; vertex: Id<"vertex"> }[],
    }));
  for (const [a, b] of segments) {
    if (length(subtract(world(a), world(b))) <= tolerance)
      throw new GeometryError(
        "DEGENERATE",
        "Segment is shorter than geometry tolerance",
      );
    sources.push({
      old: null,
      a: vertex(world(a)),
      b: vertex(world(b)),
      cuts: [],
    });
  }
  if (sources.length > 512)
    throw new GeometryError(
      "RESOURCE_LIMIT",
      "Reference intersection engine supports at most 512 source segments",
    );
  const point = (key: string) => world(model.vertices[key].position);
  for (const s of sources) {
    if (s.a === s.b)
      throw new GeometryError(
        "DEGENERATE",
        "Endpoint welding collapses an edge",
      );
    s.cuts = [
      { t: 0, vertex: s.a },
      { t: 1, vertex: s.b },
    ];
  }
  for (let i = 0; i < sources.length; i++)
    for (let j = i + 1; j < sources.length; j++) {
      const a = sources[i],
        b = sources[j];
      for (const h of segmentIntersections(
        point(a.a),
        point(a.b),
        point(b.a),
        point(b.b),
        tolerance,
        context.policy?.angular,
      )) {
        const key = vertex(h.point);
        a.cuts.push({ t: h.a, vertex: key });
        b.cuts.push({ t: h.b, vertex: key });
      }
    }
  const atoms = new Map<
    string,
    {
      a: Id<"vertex">;
      b: Id<"vertex">;
      uses: { source: number; range: [number, number] }[];
    }
  >();
  sources.forEach((s, index) => {
    const a = point(s.a),
      b = point(s.b),
      direction = subtract(b, a),
      squared = dot(direction, direction);
    for (const cut of s.cuts) {
      const p = point(cut.vertex),
        t = dot(subtract(p, a), direction) / squared,
        projection = [
          a[0] + t * direction[0],
          a[1] + t * direction[1],
          a[2] + t * direction[2],
        ] as Vec3;
      if (!near(p, projection, tolerance))
        throw new GeometryError(
          "NUMERICAL_AMBIGUITY",
          "Canonical intersection leaves its source segment",
        );
    }
    // Intersection arithmetic may produce 0.9999999999999998 for the exact
    // canonical endpoint. Preserve full-edge identity using welded vertex IDs,
    // not a relaxed parameter epsilon (which could swallow a real split).
    for (const cut of s.cuts) {
      if (cut.vertex === s.a) cut.t = 0;
      else if (cut.vertex === s.b) cut.t = 1;
    }
    s.cuts.sort((a, b) => a.t - b.t || a.vertex.localeCompare(b.vertex));
    const cuts = s.cuts.filter(
      (c, i, a) => i === 0 || c.vertex !== a[i - 1].vertex,
    );
    if (new Set(cuts.map((c) => c.vertex)).size !== cuts.length)
      throw new GeometryError(
        "NUMERICAL_AMBIGUITY",
        "Repeated non-consecutive cut vertex",
      );
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i],
        b = cuts[i + 1],
        key = [a.vertex, b.vertex].sort().join("|");
      if (near(point(a.vertex), point(b.vertex), tolerance))
        throw new GeometryError(
          "NUMERICAL_AMBIGUITY",
          "Unresolvable split interval",
        );
      let atom = atoms.get(key);
      if (!atom) {
        atom = { a: a.vertex, b: b.vertex, uses: [] };
        atoms.set(key, atom);
      }
      atom.uses.push({ source: index, range: [a.t, b.t] });
    }
  });
  const descendants = new Map<
    string,
    { id: Id<"edge">; parameterRange: [number, number]; direction: 1 | -1 }[]
  >();
  model.edges = {};
  for (const atom of atoms.values()) {
    const oldUses = atom.uses.filter((u) => sources[u.source].old),
      whole = oldUses.filter((u) => u.range[0] === 0 && u.range[1] === 1),
      keep =
        oldUses.length === 1 && whole.length === 1
          ? sources[whole[0].source].old
          : null;
    const eid = keep ?? allocate("edge");
    const old = keep ? before.edges[keep] : null;
    model.edges[eid] = {
      id: eid,
      start: old?.start ?? atom.a,
      end: old?.end ?? atom.b,
      curve: { kind: "line" },
    };
    // A kept edge is possible only when its original endpoints are unchanged.
    if (
      old &&
      (aliases.get(old.start) !== old.start || aliases.get(old.end) !== old.end)
    ) {
      delete model.edges[eid];
      const replacement = allocate("edge");
      model.edges[replacement] = {
        id: replacement,
        start: atom.a,
        end: atom.b,
        curve: { kind: "line" },
      };
      for (const use of oldUses) {
        const source = sources[use.source];
        const list = descendants.get(source.old!) ?? [];
        list.push({
          id: replacement,
          parameterRange: use.range,
          direction:
            atom.a === source.a ||
            dot(
              subtract(point(atom.b), point(atom.a)),
              subtract(point(source.b), point(source.a)),
            ) > 0
              ? 1
              : -1,
        });
        descendants.set(source.old!, list);
      }
      continue;
    }
    for (const use of oldUses) {
      const source = sources[use.source],
        list = descendants.get(source.old!) ?? [];
      list.push({
        id: eid,
        parameterRange: use.range,
        direction:
          dot(
            subtract(
              point(model.edges[eid].end),
              point(model.edges[eid].start),
            ),
            subtract(point(source.b), point(source.a)),
          ) > 0
            ? 1
            : -1,
      });
      descendants.set(source.old!, list);
    }
  }
  for (const e of Object.values(before.edges)) {
    const children = descendants
      .get(e.id)!
      .sort((a, b) => a.parameterRange[0] - b.parameterRange[0]);
    if (!model.edges[e.id])
      lineage.push({
        operationId,
        kind: "edge",
        retiredId: e.id,
        descendants: children.map(({ id, parameterRange }) => ({
          id,
          parameterRange,
        })),
        reason: children.length > 1 ? "split" : "convert",
      });
  }
  for (const loop of Object.values(model.loops)) {
    const ids: Id<"coedge">[] = [];
    for (const cid of loop.coedgeIds) {
      const co = model.coedges[cid],
        children = descendants.get(co.edgeId)!;
      if (children.length === 1 && children[0].id === co.edgeId) {
        ids.push(cid);
        continue;
      }
      const ordered = co.direction === 1 ? children : [...children].reverse(),
        newIds = ordered.map((child) => {
          const id = allocate("coedge");
          model.coedges[id] = {
            id,
            loopId: loop.id,
            edgeId: child.id,
            direction: (co.direction * child.direction) as 1 | -1,
          };
          return id;
        });
      delete model.coedges[cid];
      ids.push(...newIds);
      lineage.push({
        operationId,
        kind: "coedge",
        retiredId: cid,
        descendants: newIds.map((id) => ({ id })),
        reason: newIds.length > 1 ? "split" : "convert",
      });
    }
    loop.coedgeIds = ids;
  }
  const used = new Set(
    Object.values(model.edges).flatMap((e) => [e.start, e.end]),
  );
  for (const v of Object.values(model.vertices))
    if (!used.has(v.id) && v.role !== "construction")
      delete model.vertices[v.id];
  const resultEdges = Object.values(model.edges);
  if ((resultEdges.length * (resultEdges.length - 1)) / 2 > 250000)
    throw new GeometryError(
      "RESOURCE_LIMIT",
      "Result intersection validation budget exceeded",
    );
  // Recheck constructed (and welded) segments, not just the original inputs.
  for (let i = 0; i < resultEdges.length; i++)
    for (let j = i + 1; j < resultEdges.length; j++) {
      const a = resultEdges[i],
        b = resultEdges[j],
        shared = [a.start, a.end].filter((v) => v === b.start || v === b.end);
      for (const h of segmentIntersections(
        point(a.start),
        point(a.end),
        point(b.start),
        point(b.end),
        tolerance,
        context.policy?.angular,
      ))
        if (!shared.some((v) => near(point(v), h.point, tolerance)))
          throw new GeometryError(
            "NUMERICAL_AMBIGUITY",
            "Constructed edges contain an unresolved intersection",
            [a.id, b.id],
          );
    }
  return { model, lineage, allocate, tolerance, world, local };
}
