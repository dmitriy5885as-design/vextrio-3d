import {
  GeometryError,
  type GeometryModel,
  type Id,
  type Face,
  type Vec2,
} from "./model";
import { dot, cross, length, subtract, projectPoint } from "./math";
import { contextPlane, metric, signedArea } from "./sketch-common";
import { inside } from "./predicates";
import type { ValidationContext } from "./validate";
import type { Allocator } from "./edge-builder";
interface Use {
  edgeId: Id<"edge">;
  direction: 1 | -1;
}
// Only unions of regions explicitly connected through erased internal edges
// are restored. No global face discovery: deleted/unrelated regions stay empty.
export function restoreErasedRegions(
  before: GeometryModel,
  model: GeometryModel,
  erased: ReadonlySet<string>,
  explicitFaces: ReadonlySet<string>,
  context: ValidationContext,
  allocate: Allocator,
): Map<string, Id<"face">[]> {
  const replacements = new Map<string, Id<"face">[]>(),
    incidence = new Map<string, string[]>(),
    graph = new Map<string, Set<string>>();
  const { world, tolerance } = metric(before, context),
    angular = context.policy?.angular ?? 1e-10;
  for (const face of Object.values(before.faces))
    for (const lid of [face.outerLoopId, ...face.innerLoopIds])
      for (const cid of before.loops[lid].coedgeIds) {
        const eid = before.coedges[cid].edgeId;
        incidence.set(eid, [...(incidence.get(eid) ?? []), face.id]);
      }
  const coplanar = (a: Face, b: Face) => {
    const p = contextPlane(a.plane, context),
      q = contextPlane(b.plane, context);
    return (
      length(cross(p.normal, q.normal)) <= angular &&
      Math.abs(dot(subtract(q.origin, p.origin), p.normal)) <= tolerance
    );
  };
  for (const eid of erased) {
    const faces = incidence.get(eid) ?? [];
    if (faces.length > 2)
      throw new GeometryError(
        "UNSUPPORTED_OPERATION",
        "Нельзя стирать неманифолдное ребро с несколькими поверхностями.",
        [eid],
      );
    if (
      faces.length !== 2 ||
      !coplanar(before.faces[faces[0]], before.faces[faces[1]])
    )
      continue;
    for (const [a, b] of [
      [faces[0], faces[1]],
      [faces[1], faces[0]],
    ]) {
      const next = graph.get(a) ?? new Set<string>();
      next.add(b);
      graph.set(a, next);
    }
  }
  const visited = new Set<string>();
  for (const first of [...graph.keys()].sort()) {
    if (visited.has(first)) continue;
    const queue = [first],
      members = new Set<string>();
    for (let i = 0; i < queue.length; i++) {
      const f = queue[i];
      if (members.has(f)) continue;
      members.add(f);
      visited.add(f);
      for (const n of graph.get(f) ?? []) if (!members.has(n)) queue.push(n);
    }
    if ([...members].some((key) => explicitFaces.has(key))) continue;
    if (members.size > 512)
      throw new GeometryError(
        "RESOURCE_LIMIT",
        "За одно удаление можно объединить не более 512 граней.",
      );
    const anchor = before.faces[[...members].sort()[0]],
      plane = contextPlane(anchor.plane, context),
      uses = new Map<string, Use[]>();
    let count = 0;
    for (const key of members) {
      const face = before.faces[key],
        sign =
          dot(contextPlane(face.plane, context).normal, plane.normal) >= 0
            ? 1
            : -1;
      if (!coplanar(anchor, face))
        throw new GeometryError(
          "NON_PLANAR",
          "Стирание соединяет грани, не лежащие в одной плоскости.",
        );
      for (const lid of [face.outerLoopId, ...face.innerLoopIds])
        for (const cid of before.loops[lid].coedgeIds) {
          const c = before.coedges[cid];
          uses.set(c.edgeId, [
            ...(uses.get(c.edgeId) ?? []),
            { edgeId: c.edgeId, direction: (c.direction * sign) as 1 | -1 },
          ]);
          if (++count > 8192)
            throw new GeometryError(
              "RESOURCE_LIMIT",
              "Слишком сложная граница объединения.",
            );
        }
    }
    // Erasing any outer boundary opens the region: ordinary face removal wins.
    if ([...uses].some(([eid, list]) => list.length === 1 && erased.has(eid)))
      continue;
    for (const key of members) {
      const face = before.faces[key],
        same = dot(contextPlane(face.plane, context).normal, plane.normal) >= 0;
      if (
        (same ? face.frontMaterialId : face.backMaterialId) !==
          anchor.frontMaterialId ||
        (same ? face.backMaterialId : face.frontMaterialId) !==
          anchor.backMaterialId
      )
        throw new GeometryError(
          "UNSUPPORTED_OPERATION",
          "У соседних граней разные материалы. Их объединение пока не поддерживается.",
          [...members],
        );
    }
    const boundary: Use[] = [];
    for (const [eid, list] of uses) {
      if (list.length === 1) boundary.push(list[0]);
      else if (list.length !== 2 || list[0].direction === list[1].direction)
        throw new GeometryError(
          "INVALID_TOPOLOGY",
          "Неоднозначная ориентация общей границы.",
          [eid],
        );
      else if (!erased.has(eid))
        throw new GeometryError(
          "UNSUPPORTED_OPERATION",
          "Удалите все внутренние рёбра объединяемой области одной командой.",
          [eid],
        );
    }
    const outgoing = new Map<string, Use>(),
      incoming = new Set<string>();
    const endpoints = (u: Use) => {
      const e = before.edges[u.edgeId];
      return u.direction === 1 ? [e.start, e.end] : [e.end, e.start];
    };
    for (const u of boundary) {
      const [a, b] = endpoints(u);
      if (outgoing.has(a) || incoming.has(b))
        throw new GeometryError(
          "UNSUPPORTED_OPERATION",
          "Граница объединения касается себя в вершине.",
        );
      outgoing.set(a, u);
      incoming.add(b);
    }
    const remaining = new Set(boundary.map((u) => u.edgeId)),
      rings: { uses: Use[]; points: Vec2[]; area: number }[] = [];
    for (const start of boundary) {
      if (!remaining.has(start.edgeId)) continue;
      const ring: Use[] = [],
        begin = endpoints(start)[0];
      let current = start;
      while (true) {
        if (!remaining.delete(current.edgeId))
          throw new GeometryError(
            "INVALID_TOPOLOGY",
            "Незамкнутая граница объединения.",
          );
        ring.push(current);
        const end = endpoints(current)[1];
        if (end === begin) break;
        const next = outgoing.get(end);
        if (!next)
          throw new GeometryError(
            "INVALID_TOPOLOGY",
            "Незамкнутая граница объединения.",
          );
        current = next;
      }
      const points = ring.map((u) =>
        projectPoint(world(before.vertices[endpoints(u)[0]].position), plane),
      );
      const area = signedArea(points);
      if (Math.abs(area) <= tolerance * tolerance)
        throw new GeometryError(
          "DEGENERATE",
          "Вырожденная область объединения.",
        );
      rings.push({ uses: ring, points, area });
    }
    const outers = rings.filter((r) => r.area > 0),
      holes = rings.filter((r) => r.area < 0);
    if (
      outers.length !== 1 ||
      holes.some((h) => !inside(h.points[0], outers[0].points))
    )
      throw new GeometryError(
        "UNSUPPORTED_OPERATION",
        "Неоднозначное вложение контуров объединения.",
      );
    const shellUses = Object.values(before.shells).flatMap((s) =>
        s.faces
          .filter((f) => members.has(f.faceId))
          .map((f) => ({ shell: s.id, use: f })),
      ),
      shellIds = new Set(shellUses.map((s) => s.shell));
    if (shellIds.size > 1)
      throw new GeometryError(
        "UNSUPPORTED_OPERATION",
        "Нельзя объединить грани разных оболочек.",
      );
    const orientation = (faceId: string, value: 1 | -1) =>
      (value *
        (dot(
          contextPlane(before.faces[faceId].plane, context).normal,
          plane.normal,
        ) >= 0
          ? 1
          : -1)) as 1 | -1;
    const shellOrientation = shellUses.length
      ? orientation(shellUses[0].use.faceId, shellUses[0].use.orientation)
      : 1;
    if (
      shellUses.some(
        (s) =>
          orientation(s.use.faceId, s.use.orientation) !== shellOrientation,
      )
    )
      throw new GeometryError(
        "INVALID_TOPOLOGY",
        "Несогласованные ориентации оболочки.",
      );
    const loop = (ring: Use[]) => {
      const lid = allocate("loop"),
        coedgeIds = ring.map((use) => {
          const cid = allocate("coedge");
          model.coedges[cid] = { id: cid, loopId: lid, ...use };
          return cid;
        });
      model.loops[lid] = { id: lid, coedgeIds };
      return lid;
    };
    const fid = allocate("face");
    model.faces[fid] = {
      ...structuredClone(anchor),
      id: fid,
      outerLoopId: loop(outers[0].uses),
      innerLoopIds: holes.map((h) => loop(h.uses)),
    };
    for (const key of members) replacements.set(key, [fid]);
    for (const shell of Object.values(model.shells)) {
      let inserted = false;
      shell.faces = shell.faces.flatMap((use) => {
        if (!members.has(use.faceId)) return [use];
        if (inserted) return [];
        inserted = true;
        return [{ faceId: fid, orientation: shellOrientation }];
      });
    }
  }
  return replacements;
}
