import {
  createIdAllocator,
  entityTables,
  GeometryError,
  type GeometryModel,
  type Id,
  type Vec3,
} from "./model";
import { add, subtract, cross, dot, length } from "./math";
import { metric, contextPlane, unit } from "./sketch-common";
import type { ValidationContext } from "./validate";
import type { LineageEntry } from "./transactions";
/** Fold simple quadrilaterals only. The diagonal and triangles become real
 * topology; renderer tessellation is never used to edit canonical data. */
export function foldMovedQuads(
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
  let count = 0;
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
    if (vertices.length !== 4 || source.innerLoopIds.length)
      throw new GeometryError(
        "UNSUPPORTED_OPERATION",
        "Автоскладывание пока поддерживает только четырёхугольники без отверстий. Разделите грань линиями.",
        [source.id],
      );
    if (++count > 128)
      throw new GeometryError(
        "RESOURCE_LIMIT",
        "Не более 128 складываемых граней за операцию.",
      );
    const old = vertices.map((v) => world(before.vertices[v].position));
    const candidates = [0, 1]
      .map((start) => {
        const seq = [0, 1, 2, 3].map((i) => (start + i) % 4),
          triangles = [
            [seq[0], seq[1], seq[2]],
            [seq[0], seq[2], seq[3]],
          ],
          a = seq[0],
          b = seq[2];
        return {
          triangles,
          a,
          b,
          cost:
            Number(changed.has(vertices[a])) + Number(changed.has(vertices[b])),
          size: length(subtract(points[a], points[b])),
          key: [vertices[a], vertices[b]].sort().join("|"),
        };
      })
      .filter((c) =>
        c.triangles.every(
          (t) =>
            dot(
              cross(
                subtract(old[t[1]], old[t[0]]),
                subtract(old[t[2]], old[t[0]]),
              ),
              plane.normal,
            ) >
            tolerance * tolerance,
        ),
      )
      .sort(
        (a, b) =>
          a.cost - b.cost ||
          a.size - b.size ||
          (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
      );
    const chosen = candidates[0];
    if (!chosen)
      throw new GeometryError(
        "DEGENERATE",
        "Нет устойчивой диагонали для складывания.",
        [source.id],
      );
    if (
      Object.values(after.edges).some(
        (e) =>
          [e.start, e.end].sort().join("|") ===
          [vertices[chosen.a], vertices[chosen.b]].sort().join("|"),
      )
    )
      throw new GeometryError(
        "UNSUPPORTED_OPERATION",
        "Диагональ сгиба уже занята ребром. Сначала разделите грань.",
        [source.id],
      );
    const diagonal = allocate("edge");
    after.edges[diagonal] = {
      id: diagonal,
      start: vertices[chosen.a],
      end: vertices[chosen.b],
      curve: { kind: "line" },
    };
    const boundary = new Map(
        coedges.map((c) => {
          const e = before.edges[c.edgeId];
          return [[e.start, e.end].sort().join("|"), e.id] as const;
        }),
      ),
      newFaces: Id<"face">[] = [],
      newLoops: Id<"loop">[] = [],
      mapped = new Map<string, Id<"coedge">[]>();
    for (const triangle of chosen.triangles) {
      const fid = allocate("face"),
        lid = allocate("loop"),
        cids = triangle.map((i, k) => {
          const a = vertices[i],
            b = vertices[triangle[(k + 1) % 3]],
            eid = boundary.get([a, b].sort().join("|")) ?? diagonal,
            e = after.edges[eid],
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
        body.edgeIds.push(diagonal);
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
