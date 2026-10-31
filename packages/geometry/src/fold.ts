import {
  createIdAllocator,
  entityTables,
  GeometryError,
  type GeometryModel,
  type Id,
  type Vec3,
} from "./model";
import { add, subtract, cross, dot, length, projectPoint } from "./math";
import { metric, contextPlane, unit } from "./sketch-common";
import { foldRegions } from "./fold-regions";
import type { ValidationContext } from "./validate";
import type { LineageEntry } from "./transactions";
/** Fold simple polygons without holes. Creases and planar regions become real
 * topology; renderer tessellation is never used to edit canonical data. */
export function foldMovedFaces(
  before: GeometryModel,
  after: GeometryModel,
  changed: ReadonlySet<string>,
  context: ValidationContext,
  operationId: Id<"operation">,
): LineageEntry[] {
  const { world, tolerance } = metric(after, context),
    allocate = createIdAllocator(operationId, [
      ...entityTables.flatMap((t) => Object.keys(before[t])),
      ...(context.reservedIds ?? []),
    ]),
    lineage: LineageEntry[] = [];
  let count = 0,
    usedVertices = 0;
  const predicateBudget = { remaining: 200000 };
  for (const source of Object.values(before.faces)) {
    const loop = before.loops[source.outerLoopId],
      coedges = loop.coedgeIds.map((c) => before.coedges[c]),
      vertices = coedges.map((c) => {
        const e = before.edges[c.edgeId];
        return c.direction === 1 ? e.start : e.end;
      }),
      all = [
        ...vertices,
        ...source.innerLoopIds.flatMap((l) =>
          before.loops[l].coedgeIds.map(
            (c) => before.edges[before.coedges[c].edgeId].start,
          ),
        ),
      ];
    if (!all.some((v) => changed.has(v))) continue;
    const points = vertices.map((v) => world(after.vertices[v].position)),
      origin = points[0];
    let sum: Vec3 = [0, 0, 0];
    for (let i = 1; i < points.length - 1; i++)
      sum = add(
        sum,
        cross(subtract(points[i], origin), subtract(points[i + 1], origin)),
      );
    if (length(sum) <= tolerance * tolerance)
      throw new GeometryError("DEGENERATE", "Перемещение схлопывает грань.", [
        source.id,
      ]);
    const normal = unit(sum),
      plane = contextPlane(source.plane, context);
    if (
      all.every(
        (v) =>
          Math.abs(
            dot(subtract(world(after.vertices[v].position), origin), normal),
          ) <= tolerance,
      )
    )
      continue;
    if (vertices.length > 128)
      throw new GeometryError(
        "RESOURCE_LIMIT",
        "Автоскладывание: не более 128 вершин контура.",
        [source.id],
      );
    if (source.innerLoopIds.length)
      throw new GeometryError(
        "UNSUPPORTED_OPERATION",
        "Автоскладывание поддерживает контуры до 128 вершин без отверстий. Разделите грань линиями.",
        [source.id],
      );
    if (++count > 128)
      throw new GeometryError(
        "RESOURCE_LIMIT",
        "Не более 128 складываемых граней за операцию.",
      );
    usedVertices += vertices.length;
    if (usedVertices > 512)
      throw new GeometryError(
        "RESOURCE_LIMIT",
        "Слишком много складываемых вершин за операцию: не более 512.",
      );
    const old = vertices.map((v) => world(before.vertices[v].position)),
      regions = foldRegions(
        old.map((p) => projectPoint(p, plane)),
        points,
        vertices,
        changed,
        tolerance,
        predicateBudget,
      ),
      creases: Id<"edge">[] = [];
    const boundary = new Map(
        coedges.map((c) => {
          const e = before.edges[c.edgeId];
          return [[e.start, e.end].sort().join("|"), e.id] as const;
        }),
      ),
      newFaces: Id<"face">[] = [],
      newLoops: Id<"loop">[] = [],
      mapped = new Map<string, Id<"coedge">[]>();
    for (const region of regions) {
      const fid = allocate("face"),
        lid = allocate("loop"),
        cids = region.map((i, k) => {
          const a = vertices[i],
            b = vertices[region[(k + 1) % region.length]],
            edgeKey = [a, b].sort().join("|");
          let eid = boundary.get(edgeKey);
          if (!eid) {
            if (
              Object.values(after.edges).some(
                (e) => [e.start, e.end].sort().join("|") === edgeKey,
              )
            )
              throw new GeometryError(
                "UNSUPPORTED_OPERATION",
                "Диагональ сгиба уже занята ребром. Сначала разделите грань.",
                [source.id],
              );
            eid = allocate("edge");
            after.edges[eid] = {
              id: eid,
              start: a,
              end: b,
              curve: { kind: "line" },
            };
            boundary.set(edgeKey, eid);
            creases.push(eid);
          }
          const e = after.edges[eid],
            cid = allocate("coedge");
          after.coedges[cid] = {
            id: cid,
            edgeId: eid,
            loopId: lid,
            direction: e.start === a ? 1 : -1,
          };
          for (const c of coedges)
            if (c.edgeId === eid)
              mapped.set(c.id, [...(mapped.get(c.id) ?? []), cid]);
          return cid;
        });
      after.loops[lid] = { id: lid, coedgeIds: cids };
      after.faces[fid] = {
        ...structuredClone(source),
        id: fid,
        outerLoopId: lid,
        innerLoopIds: [],
      };
      newFaces.push(fid);
      newLoops.push(lid);
    }
    delete after.faces[source.id];
    delete after.loops[loop.id];
    for (const c of coedges) delete after.coedges[c.id];
    for (const shell of Object.values(after.shells))
      shell.faces = shell.faces.flatMap((f) =>
        f.faceId === source.id
          ? newFaces.map((faceId) => ({ ...f, faceId }))
          : [f],
      );
    for (const body of Object.values(after.bodies))
      if (body.faceIds.includes(source.id)) {
        body.faceIds = body.faceIds.flatMap((f) =>
          f === source.id ? newFaces : [f],
        );
        body.edgeIds.push(...creases);
      }
    const retire = (
      kind: LineageEntry["kind"],
      retiredId: string,
      ids: string[],
    ) =>
      lineage.push({
        operationId,
        kind,
        retiredId,
        reason: ids.length > 1 ? "split" : "convert",
        descendants: ids.map((id) => ({ id })),
      });
    retire("face", source.id, newFaces);
    retire("loop", loop.id, newLoops);
    for (const c of coedges) retire("coedge", c.id, mapped.get(c.id)!);
  }
  return lineage;
}
