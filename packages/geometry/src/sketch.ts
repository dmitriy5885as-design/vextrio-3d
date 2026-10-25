import {
  entityTables,
  GeometryError,
  type GeometryModel,
  type Id,
  type PlaneFrame,
  type Face,
  type Vec3,
} from "./model";
import {
  cross,
  dot,
  length,
  projectPoint,
  subtract,
  transformPlane,
} from "./math";
import {
  canonical,
  validateGeometry,
  type ValidationContext,
} from "./validate";
import {
  diffGeometry,
  invertDelta,
  type LineageEntry,
  type PreparedGeometryChange,
} from "./transactions";
import {
  discoverPlanes,
  planeCells,
  type Boundary,
  type Cell,
} from "./arrangement";
import { splitSegments, type Allocator } from "./edge-builder";
import { inRegion, metric, onPlane, unit } from "./sketch-common";
export type SketchOperation =
  | {
      kind: "insert-segments";
      segments: [Vec3, Vec3][];
      plane: PlaneFrame | null;
    }
  | { kind: "make-face"; boundaryEdgeIds: Id<"edge">[] }
  | { kind: "delete-entities"; entityIds: string[] };
const cycleKey = (uses: Boundary["uses"]) => {
  const words = uses.map((u) => u.edgeId + ":" + u.direction);
  return words
    .map((_, i) => [...words.slice(i), ...words.slice(0, i)].join("|"))
    .sort()[0];
};
const boundaryKey = (uses: Boundary["uses"]) =>
  [
    cycleKey(uses),
    cycleKey(
      [...uses]
        .reverse()
        .map((u) => ({ ...u, direction: -u.direction as 1 | -1 })),
    ),
  ].sort()[0];
function loopUses(m: GeometryModel, lid: string): Boundary["uses"] {
  return m.loops[lid].coedgeIds.map((cid) => ({
    edgeId: m.coedges[cid].edgeId,
    direction: m.coedges[cid].direction,
  }));
}
function faceKey(m: GeometryModel, f: Face) {
  return (
    boundaryKey(loopUses(m, f.outerLoopId)) +
    "#" +
    f.innerLoopIds
      .map((l) => boundaryKey(loopUses(m, l)))
      .sort()
      .join("#")
  );
}
function faceContains(
  m: GeometryModel,
  f: Face,
  point: Vec3,
  context: ValidationContext,
  tolerance: number,
): boolean {
  const { world } = metric(m, context),
    plane = context.placement
      ? transformPlane(f.plane, context.placement)
      : f.plane;
  if (!onPlane(point, plane, tolerance)) return false;
  const polygon = (lid: string) =>
    loopUses(m, lid).map((use) => {
      const e = m.edges[use.edgeId];
      return projectPoint(
        world(m.vertices[use.direction === 1 ? e.start : e.end].position),
        plane,
      );
    });
  return inRegion(
    projectPoint(point, plane),
    polygon(f.outerLoopId),
    f.innerLoopIds.map(polygon),
  );
}
function rebuildBodies(
  model: GeometryModel,
  before: GeometryModel,
  allocate: Allocator,
  aliases: Map<string, string>,
) {
  const parent = new Map<string, string>();
  const root = (v: string): string => {
    let p = parent.get(v) ?? v;
    while (p !== (parent.get(p) ?? p)) p = parent.get(p)!;
    let n = v;
    while (parent.has(n) && parent.get(n) !== p) {
      const next = parent.get(n)!;
      parent.set(n, p);
      n = next;
    }
    return p;
  };
  const union = (a: string, b: string) => {
    const x = root(a),
      y = root(b);
    if (x !== y) parent.set(y, x);
  };
  for (const e of Object.values(model.edges)) {
    parent.set(e.start, e.start);
    parent.set(e.end, e.end);
  }
  for (const e of Object.values(model.edges)) union(e.start, e.end);
  const faceEdges = new Map<string, Id<"edge">[]>();
  for (const f of Object.values(model.faces)) {
    const edges = [
      ...new Set(
        [f.outerLoopId, ...f.innerLoopIds].flatMap((l) =>
          loopUses(model, l).map((u) => u.edgeId),
        ),
      ),
    ];
    faceEdges.set(f.id, edges);
    for (const e of edges)
      union(model.edges[edges[0]].start, model.edges[e].start);
  }
  const parts = new Map<string, Id<"edge">[]>();
  for (const e of Object.values(model.edges)) {
    const key = root(e.start),
      list = parts.get(key) ?? [];
    list.push(e.id);
    parts.set(key, list);
  }
  const components = [...parts.values()].map((edgeIds) => {
    const vertices = [
      ...new Set(
        edgeIds.flatMap((e) => [model.edges[e].start, model.edges[e].end]),
      ),
    ];
    const candidates = Object.values(before.bodies).filter((b) =>
      b.vertexIds.some((v) =>
        vertices.includes((aliases.get(v) ?? v) as Id<"vertex">),
      ),
    );
    return { edgeIds, vertices, candidates };
  });
  model.bodies = {};
  for (const part of components) {
    const sole = part.candidates.length === 1 ? part.candidates[0] : null,
      keep =
        sole &&
        components.filter((c) => c.candidates.some((b) => b.id === sole.id))
          .length === 1
          ? sole.id
          : null;
    const bid = keep ?? allocate("body");
    model.bodies[bid] = {
      id: bid,
      vertexIds: part.vertices.sort(),
      edgeIds: part.edgeIds.sort(),
      faceIds: Object.values(model.faces)
        .filter((f) => part.edgeIds.includes(faceEdges.get(f.id)![0]))
        .map((f) => f.id)
        .sort(),
      shellIds: [],
    };
  }
  for (const shell of Object.values(model.shells)) {
    const b = Object.values(model.bodies).find((b) =>
      shell.faces.every((f) => b.faceIds.includes(f.faceId)),
    );
    if (!b)
      throw new GeometryError(
        "INVALID_TOPOLOGY",
        "Shell crosses body membership",
      );
    b.shellIds.push(shell.id);
  }
  // Preserve redundant list order for unchanged sets: repeat drawing is a no-op.
  for (const b of Object.values(model.bodies)) {
    const old = before.bodies[b.id];
    if (old)
      for (const key of [
        "vertexIds",
        "edgeIds",
        "faceIds",
        "shellIds",
      ] as const)
        if (canonical([...b[key]].sort()) === canonical([...old[key]].sort()))
          Object.assign(b, { [key]: structuredClone(old[key]) });
  }
}
function regenerateFaces(
  before: GeometryModel,
  beforeGraph: GeometryModel,
  model: GeometryModel,
  context: ValidationContext,
  allocate: Allocator,
  tolerance: number,
  world: (p: Vec3) => Vec3,
  local: (p: Vec3) => Vec3,
  declared: PlaneFrame | null,
  force: Id<"edge">[] | null,
) {
  const planes = discoverPlanes(model, world, tolerance, context, declared),
    cells: Cell[] = [];
  for (const plane of planes)
    cells.push(...planeCells(model, plane, world, tolerance));
  const oldFaces = Object.values(model.faces),
    oldLoops = structuredClone(model.loops),
    oldCoedges = structuredClone(model.coedges),
    existing = new Map(oldFaces.map((f) => [faceKey(model, f), f]));
  const oldByLoop = new Map(
    Object.values(model.loops).map((l) => [cycleKey(loopUses(model, l.id)), l]),
  );
  const beforeCells = new Map<PlaneFrame, Cell[]>();
  for (const plane of planes)
    beforeCells.set(plane, planeCells(beforeGraph, plane, world, tolerance));
  model.faces = {};
  model.loops = {};
  model.coedges = {};
  const replacements = new Map<string, Id<"face">[]>();
  let forced = false;
  function loop(uses: Boundary["uses"]) {
    const key = cycleKey(uses),
      old = oldByLoop.get(key);
    if (old) {
      model.loops[old.id] = old;
      for (const cid of old.coedgeIds) model.coedges[cid] = oldCoedges[cid];
      return old.id;
    }
    const lid = allocate("loop"),
      coedgeIds = uses.map((u) => {
        const cid = allocate("coedge");
        model.coedges[cid] = { id: cid, loopId: lid, ...u };
        return cid;
      });
    model.loops[lid] = { id: lid, coedgeIds };
    return lid;
  }
  for (const cell of cells) {
    const containing = Object.values(before.faces)
      .filter((f) => {
        const p = context.placement
          ? transformPlane(f.plane, context.placement)
          : f.plane;
        return (
          length(cross(p.normal, cell.plane.normal)) <=
            (context.policy?.angular ?? 1e-10) &&
          faceContains(before, f, cell.sample, context, tolerance)
        );
      })
      .sort((a, b) => a.id.localeCompare(b.id));
    if (containing.length > 1)
      throw new GeometryError(
        "INVALID_TOPOLOGY",
        "Overlapping source faces on the same plane",
      );
    const emptyBefore = beforeCells.get(cell.plane)!.some((old) =>
      inRegion(
        projectPoint(cell.sample, cell.plane),
        old.outer.points,
        old.holes.map((h) => h.points),
      ),
    );
    const matchesForce =
      force !== null &&
      canonical([...force].sort()) ===
        canonical(cell.outer.uses.map((u) => u.edgeId).sort());
    if (matchesForce) forced = true;
    if (!matchesForce && !containing.length && emptyBefore) continue;
    const holeUses = cell.holes.map((h) =>
        [...h.uses].reverse().map((u) => ({
          edgeId: u.edgeId,
          direction: -u.direction as 1 | -1,
        })),
      ),
      key =
        boundaryKey(cell.outer.uses) +
        "#" +
        holeUses.map(boundaryKey).sort().join("#"),
      retained = existing.get(key);
    if (retained) {
      model.faces[retained.id] = retained;
      for (const lid of [retained.outerLoopId, ...retained.innerLoopIds]) {
        model.loops[lid] = oldLoops[lid];
        for (const cid of oldLoops[lid].coedgeIds)
          model.coedges[cid] = oldCoedges[cid];
      }
      continue;
    }
    const inherited = containing[0],
      inheritedPlane = inherited
        ? context.placement
          ? transformPlane(inherited.plane, context.placement)
          : inherited.plane
        : null,
      flipped = inheritedPlane
        ? dot(inheritedPlane.normal, cell.plane.normal) < 0
        : false;
    const front =
        (flipped ? inherited?.backMaterialId : inherited?.frontMaterialId) ??
        ([...context.materialIds].sort()[0] as Id<"material">),
      back =
        (flipped ? inherited?.frontMaterialId : inherited?.backMaterialId) ??
        front;
    if (!front)
      throw new GeometryError(
        "INVALID_TOPOLOGY",
        "Automatic faces require an existing material ID",
      );
    const fid = allocate("face"),
      origin = local(cell.plane.origin),
      u0 = subtract(
        local([
          cell.plane.origin[0] + cell.plane.u[0],
          cell.plane.origin[1] + cell.plane.u[1],
          cell.plane.origin[2] + cell.plane.u[2],
        ]),
        origin,
      ),
      v0 = subtract(
        local([
          cell.plane.origin[0] + cell.plane.v[0],
          cell.plane.origin[1] + cell.plane.v[1],
          cell.plane.origin[2] + cell.plane.v[2],
        ]),
        origin,
      ),
      u = unit(u0),
      normal = unit(cross(u0, v0));
    const outerLoopId = loop(cell.outer.uses),
      innerLoopIds = holeUses.map(loop);
    model.faces[fid] = {
      id: fid,
      plane: { origin, u, v: cross(normal, u), normal },
      outerLoopId,
      innerLoopIds,
      frontMaterialId: front,
      backMaterialId: back,
    };
    for (const old of containing) {
      const list = replacements.get(old.id) ?? [];
      list.push(fid);
      replacements.set(old.id, list);
    }
  }
  if (force !== null && !forced)
    throw new GeometryError(
      "INVALID_TOPOLOGY",
      "Boundary must identify one complete bounded planar cell",
    );
  // Retained shells replace all face uses, including faces on other planes.
  for (const shell of Object.values(model.shells)) {
    shell.faces = shell.faces.flatMap((use) =>
      model.faces[use.faceId]
        ? [use]
        : (replacements.get(use.faceId) ?? []).map((faceId) => ({
            faceId,
            orientation: use.orientation,
          })),
    );
    if (!shell.faces.length) delete model.shells[shell.id];
  }
  return replacements;
}
export function prepareSketch(
  before: GeometryModel,
  operation: SketchOperation,
  context: ValidationContext,
  operationId: Id<"operation">,
): PreparedGeometryChange {
  validateGeometry(before, context);
  if (
    operation.kind === "delete-entities" &&
    (!operation.entityIds.length ||
      operation.entityIds.some((key) => !before.faces[key]))
  )
    throw new GeometryError(
      "UNSUPPORTED_OPERATION",
      "S3 delete supports existing faces only",
    );
  if (
    operation.kind === "make-face" &&
    (operation.boundaryEdgeIds.length < 3 ||
      new Set(operation.boundaryEdgeIds).size !==
        operation.boundaryEdgeIds.length ||
      operation.boundaryEdgeIds.some((e) => !before.edges[e]))
  )
    throw new GeometryError("INVALID_TOPOLOGY", "Invalid face boundary");
  const split = splitSegments(
      before,
      operation.kind === "insert-segments" ? operation.segments : [],
      context,
      operationId,
      operation.kind === "insert-segments" ? operation.plane : null,
    ),
    model = split.model;
  let replacements = new Map<string, Id<"face">[]>();
  if (operation.kind === "delete-entities") {
    for (const fid of operation.entityIds) {
      const f = model.faces[fid];
      for (const lid of [f.outerLoopId, ...f.innerLoopIds]) {
        for (const cid of model.loops[lid].coedgeIds) delete model.coedges[cid];
        delete model.loops[lid];
      }
      delete model.faces[fid];
    }
    for (const shell of Object.values(model.shells)) {
      shell.faces = shell.faces.filter((f) => model.faces[f.faceId]);
      if (!shell.faces.length) delete model.shells[shell.id];
    }
  } else
    replacements = regenerateFaces(
      before,
      splitSegments(before, [], context, operationId).model,
      model,
      context,
      split.allocate,
      split.tolerance,
      split.world,
      split.local,
      operation.kind === "insert-segments" ? operation.plane : null,
      operation.kind === "make-face" ? operation.boundaryEdgeIds : null,
    );
  const vertexAliases = new Map(
    split.lineage
      .filter((l) => l.kind === "vertex" && l.descendants.length === 1)
      .map((l) => [l.retiredId, l.descendants[0].id]),
  );
  rebuildBodies(model, before, split.allocate, vertexAliases);
  validateGeometry(model, context);
  const forward = diffGeometry(before, model),
    lineage: LineageEntry[] = split.lineage.filter((e) =>
      forward[
        (
          {
            vertex: "vertices",
            edge: "edges",
            coedge: "coedges",
            loop: "loops",
            face: "faces",
            shell: "shells",
            body: "bodies",
          } as const
        )[e.kind]
      ].some((p) => p.id === e.retiredId && p.after === null),
    );
  for (const entry of lineage)
    entry.descendants = entry.descendants.filter((d) =>
      Object.values(
        model[
          (
            {
              vertex: "vertices",
              edge: "edges",
              coedge: "coedges",
              loop: "loops",
              face: "faces",
              shell: "shells",
              body: "bodies",
            } as const
          )[entry.kind]
        ],
      ).some((e) => e.id === d.id),
    );
  for (const table of entityTables)
    for (const patch of forward[table])
      if (
        patch.before !== null &&
        patch.after === null &&
        !lineage.some((l) => l.retiredId === patch.id)
      ) {
        const kind = (
          {
            vertices: "vertex",
            edges: "edge",
            coedges: "coedge",
            loops: "loop",
            faces: "face",
            shells: "shell",
            bodies: "body",
          } as const
        )[table];
        const descendants =
          table === "faces"
            ? (replacements.get(patch.id) ?? [])
                .filter((fid) => !before.faces[fid])
                .map((id) => ({ id }))
            : table === "bodies"
              ? Object.values(model.bodies)
                  .filter(
                    (b) =>
                      !before.bodies[b.id] &&
                      b.vertexIds.some((v) =>
                        before.bodies[patch.id].vertexIds.some(
                          (old) => (vertexAliases.get(old) ?? old) === v,
                        ),
                      ),
                  )
                  .map((b) => ({ id: b.id }))
              : [];
        lineage.push({
          operationId,
          kind,
          retiredId: patch.id,
          descendants,
          reason:
            descendants.length > 1
              ? "split"
              : descendants.length
                ? "convert"
                : "delete",
        });
      }
  for (const entry of lineage)
    if (!entry.descendants.length) entry.reason = "delete";
  // Loop/coedge references follow the replacement faces, rather than being
  // silently discarded when an arrangement subdivides a source face.
  const ownerOfLoop = new Map<string, string>();
  for (const f of Object.values(before.faces))
    for (const lid of [f.outerLoopId, ...f.innerLoopIds])
      ownerOfLoop.set(lid, f.id);
  const mappedEdges = (eid: string) =>
    model.edges[eid]
      ? [eid]
      : (lineage
          .find((l) => l.kind === "edge" && l.retiredId === eid)
          ?.descendants.map((d) => d.id) ?? []);
  for (const entry of lineage)
    if (entry.kind === "loop" || entry.kind === "coedge") {
      const oldLoop =
          entry.kind === "loop"
            ? entry.retiredId
            : before.coedges[entry.retiredId].loopId,
        oldFace = ownerOfLoop.get(oldLoop),
        newFaces = oldFace
          ? model.faces[oldFace]
            ? [oldFace]
            : (replacements.get(oldFace) ?? [])
          : [];
      const newLoops = newFaces.flatMap((fid) => [
        model.faces[fid].outerLoopId,
        ...model.faces[fid].innerLoopIds,
      ]);
      const edgeIds =
        entry.kind === "loop"
          ? loopUses(before, oldLoop).flatMap((u) => mappedEdges(u.edgeId))
          : mappedEdges(before.coedges[entry.retiredId].edgeId);
      const ids =
        entry.kind === "loop"
          ? newLoops.filter(
              (lid) =>
                !before.loops[lid] &&
                loopUses(model, lid).some((u) => edgeIds.includes(u.edgeId)),
            )
          : newLoops
              .flatMap((lid) => model.loops[lid].coedgeIds)
              .filter(
                (cid) =>
                  !before.coedges[cid] &&
                  edgeIds.includes(model.coedges[cid].edgeId) &&
                  model.coedges[cid].direction ===
                    before.coedges[entry.retiredId].direction,
              );
      entry.descendants = [...new Set<string>(ids)].map((id) => ({ id }));
      entry.reason =
        ids.length > 1 ? "split" : ids.length ? "convert" : "delete";
    }
  for (const entry of lineage)
    if (
      entry.descendants.length === 1 &&
      lineage.some(
        (other) =>
          other !== entry &&
          other.kind === entry.kind &&
          other.descendants.some((d) => d.id === entry.descendants[0].id),
      )
    )
      entry.reason = "merge";
  return { forward, inverse: invertDelta(forward), lineage };
}
