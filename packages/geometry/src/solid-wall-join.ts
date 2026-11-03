import {
  GeometryError,
  defaultPolicy,
  entityTables,
  type Body,
  type Face,
  type GeometryModel,
  type Id,
  type Vec3,
} from "./model";
import {
  classifyBody,
  validateGeometry,
  type ValidationContext,
} from "./validate";
import { metric, contextPlane, inRegion } from "./sketch-common";
import { length, subtract, projectPoint } from "./math";
import { splitSegments } from "./edge-builder";
import { planeCells, type Boundary } from "./arrangement";
import { bodyVolume } from "./volume";
import { finishArrangement } from "./sketch";

interface Box {
  body: Body;
  min: Vec3;
  max: Vec3;
}
function axisOf(face: Face, t: number) {
  const axis = face.plane.normal.findIndex((n) => Math.abs(n) > 1 - t);
  return axis >= 0 &&
    face.plane.normal.every((n, i) => i === axis || Math.abs(n) < t)
    ? axis
    : -1;
}
function box(model: GeometryModel, body: Body, t: number): Box | null {
  if (
    body.vertexIds.length !== 8 ||
    body.edgeIds.length !== 12 ||
    body.faceIds.length !== 6 ||
    body.shellIds.length > 1 ||
    classifyBody(model, body.id) !== "closed-shell"
  )
    return null;
  const points = body.vertexIds.map((v) => model.vertices[v].position);
  const min = [0, 1, 2].map((k) =>
    Math.min(...points.map((p) => p[k])),
  ) as Vec3;
  const max = [0, 1, 2].map((k) =>
    Math.max(...points.map((p) => p[k])),
  ) as Vec3;
  if (min.some((n, k) => max[k] - n <= t)) return null;
  const corners = new Set<string>();
  for (const p of points) {
    const corner = p.map((n, k) =>
      Math.abs(n - min[k]) <= t ? 0 : Math.abs(n - max[k]) <= t ? 1 : -1,
    );
    if (corner.includes(-1)) return null;
    corners.add(corner.join());
  }
  if (corners.size !== 8) return null;
  const planes = new Set<string>();
  for (const fid of body.faceIds) {
    const f = model.faces[fid],
      axis = axisOf(f, 1e-10);
    if (
      axis < 0 ||
      f.innerLoopIds.length ||
      model.loops[f.outerLoopId].coedgeIds.length !== 4
    )
      return null;
    const side =
      Math.abs(f.plane.origin[axis] - min[axis]) <= t
        ? -1
        : Math.abs(f.plane.origin[axis] - max[axis]) <= t
          ? 1
          : 0;
    const orientation =
      body.shellIds
        .flatMap((s) => model.shells[s].faces)
        .find((u) => u.faceId === fid)?.orientation ?? 1;
    if (!side || f.plane.normal[axis] * orientation * side <= 0) return null;
    planes.add(axis + ":" + side);
  }
  return planes.size === 6 ? { body, min, max } : null;
}

/** Restricted face-contact union: axis-aligned rectangular solids in one
 * GeometryModel. The moving box's complete end must lie on the other box. */
export function prepareSolidWallJoin(
  before: GeometryModel,
  moved: GeometryModel,
  changed: ReadonlySet<string>,
  context: ValidationContext,
  operationId: Id<"operation">,
) {
  const { world, local, tolerance } = metric(moved, context);
  const origin = world([0, 0, 0]);
  const scales = [0, 1, 2].map((k) => {
    const v: Vec3 = [0, 0, 0];
    v[k] = 1;
    return length(subtract(world(v), origin));
  });
  const t = tolerance / Math.min(...scales);
  const movingBodies = Object.values(moved.bodies).filter((b) =>
    b.vertexIds.some((v) => changed.has(v)),
  );
  if (movingBodies.length !== 1) return null;
  const source = box(moved, movingBodies[0], t);
  if (!source) return null;
  const contacts: { target: Box; axis: number; coordinate: number }[] = [];
  for (const body of Object.values(moved.bodies)) {
    if (body.id === source.body.id) continue;
    const target = box(moved, body, t);
    if (!target) continue;
    const overlap = [0, 1, 2].map(
      (k) =>
        Math.min(source.max[k], target.max[k]) -
        Math.max(source.min[k], target.min[k]),
    );
    if (overlap.every((n) => n > t))
      throw new GeometryError(
        "UNSUPPORTED_OPERATION",
        "Для соединения придвиньте торец к стене без взаимного проникновения тел.",
      );
    for (let axis = 0; axis < 3; axis++) {
      if (![0, 1, 2].filter((k) => k !== axis).every((k) => overlap[k] > t))
        continue;
      const coordinate =
        Math.abs(source.min[axis] - target.max[axis]) <= t
          ? target.max[axis]
          : Math.abs(source.max[axis] - target.min[axis]) <= t
            ? target.min[axis]
            : null;
      if (coordinate === null) continue;
      if (
        ![0, 1, 2]
          .filter((k) => k !== axis)
          .every(
            (k) =>
              source.min[k] >= target.min[k] - t &&
              source.max[k] <= target.max[k] + t,
          )
      )
        throw new GeometryError(
          "UNSUPPORTED_OPERATION",
          "Торец перегородки должен целиком помещаться на прямоугольной стене.",
        );
      contacts.push({ target, axis, coordinate });
    }
  }
  if (!contacts.length) return null;
  if (contacts.length !== 1)
    throw new GeometryError(
      "UNSUPPORTED_OPERATION",
      "За одно перемещение соединяются только две прямоугольные стены.",
    );
  const { target, axis, coordinate } = contacts[0];
  const bodies = [source.body, target.body],
    faces = new Set(bodies.flatMap((b) => b.faceIds));
  const members = {
    vertices: new Set<string>(bodies.flatMap((b) => b.vertexIds)),
    edges: new Set<string>(bodies.flatMap((b) => b.edgeIds)),
    faces: new Set<string>(faces),
    shells: new Set<string>(bodies.flatMap((b) => b.shellIds)),
    bodies: new Set<string>(bodies.map((b) => b.id)),
    loops: new Set<string>(),
    coedges: new Set<string>(),
  };
  for (const fid of faces)
    for (const lid of [
      moved.faces[fid].outerLoopId,
      ...moved.faces[fid].innerLoopIds,
    ]) {
      members.loops.add(lid);
      for (const cid of moved.loops[lid].coedgeIds) members.coedges.add(cid);
    }
  const scoped = { ...moved };
  for (const table of entityTables)
    Object.assign(scoped, {
      [table]: Object.fromEntries(
        Object.entries(moved[table]).filter(([key]) => members[table].has(key)),
      ),
    });
  const split = splitSegments(
    scoped,
    [],
    {
      ...context,
      policy: {
        ...(context.policy ?? defaultPolicy),
        absoluteDistance: tolerance,
        relativeDistance: 0,
      },
      reservedIds: new Set([
        ...(context.reservedIds ?? []),
        ...entityTables.flatMap((table) => Object.keys(moved[table])),
      ]),
    },
    operationId,
  );
  const m = split.model,
    allocate = split.allocate;
  const fragments = [...faces].map((fid) => {
    const original = moved.faces[fid],
      plane = contextPlane(original.plane, context);
    const polygon = moved.loops[original.outerLoopId].coedgeIds.map((cid) => {
      const co = moved.coedges[cid],
        e = moved.edges[co.edgeId];
      return projectPoint(
        world(moved.vertices[co.direction === 1 ? e.start : e.end].position),
        plane,
      );
    });
    const cells = planeCells(m, plane, world, tolerance).filter((cell) => {
      if (!inRegion(projectPoint(cell.sample, plane), polygon)) return false;
      if (
        axisOf(original, 1e-10) !== axis ||
        Math.abs(original.plane.origin[axis] - coordinate) > t
      )
        return true;
      const p = local(cell.sample);
      return ![0, 1, 2]
        .filter((k) => k !== axis)
        .every((k) => p[k] > source.min[k] - t && p[k] < source.max[k] + t);
    });
    const owner = bodies.find((b) => b.faceIds.includes(fid))!;
    const orientation =
      owner.shellIds
        .flatMap((s) => moved.shells[s].faces)
        .find((u) => u.faceId === fid)?.orientation ?? 1;
    return { original, cells, orientation };
  });
  m.faces = {};
  m.loops = {};
  m.coedges = {};
  m.shells = {};
  m.bodies = {};
  const shellId = allocate("shell"),
    bodyId = allocate("body");
  m.shells[shellId] = { id: shellId, faces: [] };
  const replacements = new Map<string, Id<"face">[]>();
  const loop = (uses: Boundary["uses"]) => {
    const lid = allocate("loop"),
      coedgeIds = uses.map((use) => {
        const cid = allocate("coedge");
        m.coedges[cid] = { id: cid, loopId: lid, ...use };
        return cid;
      });
    m.loops[lid] = { id: lid, coedgeIds };
    return lid;
  };
  for (const { original, cells, orientation } of fragments) {
    const ids: Id<"face">[] = [];
    cells.forEach((cell, i) => {
      const fid = i === 0 ? original.id : allocate("face");
      ids.push(fid);
      m.faces[fid] = {
        ...structuredClone(original),
        id: fid,
        outerLoopId: loop(cell.outer.uses),
        innerLoopIds: cell.holes.map((h) =>
          loop(
            [...h.uses]
              .reverse()
              .map((u) => ({ ...u, direction: -u.direction as 1 | -1 })),
          ),
        ),
      };
      m.shells[shellId].faces.push({ faceId: fid, orientation });
    });
    replacements.set(original.id, ids);
  }
  const usedEdges = new Set(Object.values(m.coedges).map((c) => c.edgeId));
  for (const key of Object.keys(m.edges))
    if (!usedEdges.has(m.edges[key].id)) delete m.edges[key];
  const usedVertices = new Set(
    Object.values(m.edges).flatMap((e) => [e.start, e.end]),
  );
  for (const key of Object.keys(m.vertices))
    if (!usedVertices.has(m.vertices[key].id)) delete m.vertices[key];
  m.bodies[bodyId] = {
    id: bodyId,
    vertexIds: Object.values(m.vertices).map((v) => v.id),
    edgeIds: Object.values(m.edges).map((e) => e.id),
    faceIds: Object.values(m.faces).map((f) => f.id),
    shellIds: [shellId],
  };
  for (const table of entityTables)
    for (const [key, value] of Object.entries(moved[table]))
      if (!members[table].has(key))
        Object.assign(m[table], { [key]: structuredClone(value) });
  validateGeometry(m, context);
  if (classifyBody(m, bodyId) !== "closed-shell")
    throw new GeometryError(
      "INVALID_TOPOLOGY",
      "Стык стен не сохранил замкнутую оболочку.",
    );
  const expected =
    bodyVolume(moved, source.body.id, context.worldTransform)! +
    bodyVolume(moved, target.body.id, context.worldTransform)!;
  const actual = bodyVolume(m, bodyId, context.worldTransform)!;
  if (
    !(actual > 0) ||
    Math.abs(actual - expected) > Math.max(expected * 1e-8, tolerance * 100)
  )
    throw new GeometryError(
      "INVALID_TOPOLOGY",
      "Стык стен изменил ожидаемый объём материала.",
    );
  const aliases = new Map(
    split.lineage
      .filter((l) => l.kind === "vertex" && l.descendants.length === 1)
      .map((l) => [l.retiredId, l.descendants[0].id]),
  );
  // Explicit shells are replaced by the one new closed boundary; keep that
  // relationship in provenance rather than reporting both shells as deleted.
  for (const sid of members.shells)
    split.lineage.push({
      operationId,
      kind: "shell",
      retiredId: sid,
      descendants: [{ id: shellId }],
      reason: "merge",
    });
  return finishArrangement(
    before,
    m,
    split.lineage,
    replacements,
    aliases,
    operationId,
  );
}
