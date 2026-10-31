import {
  GeometryError,
  id,
  createIdAllocator,
  entityTables,
  type GeometryModel,
  type Id,
  type Vec3,
} from "./model";

import {
  add,
  subtract,
  cross,
  dot,
  length,
  assertVector,
  projectPoint,
  multiply,
} from "./math";

import { metric, unit, contextPlane, inRegion } from "./sketch-common";

import { validateGeometry, type ValidationContext } from "./validate";

import { diffGeometry, invertDelta } from "./transactions";

import { segmentIntersections } from "./intersections";

import { assertFaceContacts } from "./volume";

import { foldMovedFaces } from "./fold";
import type { LineageEntry } from "./transactions";
import { rebuildBodies } from "./sketch";

export interface MoveEntity {
  kind: "vertex" | "edge" | "face";
  id: string;
}

export function moveSelection(model: GeometryModel, entities: MoveEntity[]) {
  if (!Array.isArray(entities) || !entities.length || entities.length > 512)
    throw new GeometryError(
      "RESOURCE_LIMIT",
      "Выберите от 1 до 512 элементов.",
    );

  const vertices = new Set<Id<"vertex">>(),
    edges = new Set<Id<"edge">>(),
    faces = new Set<Id<"face">>();

  for (const entity of entities) {
    if (entity.kind === "vertex" && model.vertices[entity.id])
      vertices.add(model.vertices[entity.id].id);
    else if (entity.kind === "edge" && model.edges[entity.id])
      edges.add(model.edges[entity.id].id);
    else if (entity.kind === "face" && model.faces[entity.id])
      faces.add(model.faces[entity.id].id);
    else
      throw new GeometryError(
        "INVALID_TOPOLOGY",
        "Элемент перемещения не найден.",
        [entity.id],
      );
  }

  for (const fid of faces) {
    const f = model.faces[fid];

    for (const lid of [f.outerLoopId, ...f.innerLoopIds])
      for (const cid of model.loops[lid].coedgeIds)
        edges.add(model.coedges[cid].edgeId);
  }

  for (const eid of edges) {
    vertices.add(model.edges[eid].start);
    vertices.add(model.edges[eid].end);
  }

  if (vertices.size > 4096 || edges.size > 4096)
    throw new GeometryError(
      "RESOURCE_LIMIT",
      "Перемещение: не более 4096 вершин и рёбер.",
    );
  return { vertices, edges, faces };
}

function finish(
  before: GeometryModel,
  after: GeometryModel,
  changed: Set<string>,
  context: ValidationContext,
  lineage: LineageEntry[] = [],
) {
  const { world, tolerance } = metric(after, context),
    affected = new Set<string>();

  for (const f of Object.values(after.faces)) {
    const rings = [f.outerLoopId, ...f.innerLoopIds].map((lid) =>
      after.loops[lid].coedgeIds.map((cid) => {
        const c = after.coedges[cid],
          e = after.edges[c.edgeId];
        return c.direction === 1 ? e.start : e.end;
      }),
    );

    if (!rings.flat().some((v) => changed.has(v))) continue;

    affected.add(f.id);

    const points = rings[0].map((v) => after.vertices[v].position),
      origin = points[0];

    let sum: Vec3 = [0, 0, 0];

    for (let i = 1; i < points.length - 1; i++)
      sum = add(
        sum,
        cross(subtract(points[i], origin), subtract(points[i + 1], origin)),
      );

    if (length(sum) < 1e-20)
      throw new GeometryError("DEGENERATE", "Перемещение схлопывает грань.", [
        f.id,
      ]);

    const normal = unit(sum),
      u = unit(
        subtract(
          subtract(points[1], origin),
          multiply(normal, dot(subtract(points[1], origin), normal)),
        ),
      );

    if (dot(normal, f.plane.normal) <= 0)
      throw new GeometryError(
        "DEGENERATE",
        "Перемещение переворачивает грань. Уменьшите расстояние.",
        [f.id],
      );

    // JSON stores both signed zero representations as 0. Canonicalise only
    // the freshly computed frame, preserving all nonzero coordinates.
    const zero = (v: Vec3) => v.map((n) => (n === 0 ? 0 : n)) as Vec3;
    f.plane = {
      origin: zero(origin),
      u: zero(u),
      v: zero(cross(normal, u)),
      normal: zero(normal),
    };
  }

  validateGeometry(after, context);

  const edges = Object.values(after.edges),
    moved = new Set(
      edges
        .filter(
          (e) =>
            !before.edges[e.id] || changed.has(e.start) || changed.has(e.end),
        )
        .map((e) => e.id),
    );

  let pairs = 0;

  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length; j++) {
      const a = edges[i],
        b = edges[j];
      if (!moved.has(a.id) && !moved.has(b.id)) continue;

      if (++pairs > 200000)
        throw new GeometryError(
          "RESOURCE_LIMIT",
          "Слишком много контактов для проверки перемещения.",
        );

      const ap = world(after.vertices[a.start].position),
        aq = world(after.vertices[a.end].position),
        bp = world(after.vertices[b.start].position),
        bq = world(after.vertices[b.end].position);

      if (
        [0, 1, 2].some(
          (k) =>
            Math.max(ap[k], aq[k]) + tolerance < Math.min(bp[k], bq[k]) ||
            Math.max(bp[k], bq[k]) + tolerance < Math.min(ap[k], aq[k]),
        )
      )
        continue;

      const common = [a.start, a.end].filter(
        (v) => v === b.start || v === b.end,
      );

      for (const hit of segmentIntersections(
        ap,
        aq,
        bp,
        bq,
        tolerance,
        context.policy?.angular,
      ))
        if (
          !common.some(
            (v) =>
              length(subtract(hit.point, world(after.vertices[v].position))) <=
              tolerance,
          )
        )
          throw new GeometryError(
            "UNSUPPORTED_OPERATION",
            "Перемещение создаёт новый контакт рёбер. Разделите геометрию или выберите другую точку.",
            [a.id, b.id],
          );
    }

  const vertices = Object.values(after.vertices);
  let vertexPairs = 0;
  for (let i = 0; i < vertices.length; i++)
    for (let j = i + 1; j < vertices.length; j++) {
      const a = vertices[i],
        b = vertices[j];
      if (!changed.has(a.id) && !changed.has(b.id)) continue;
      if (++vertexPairs > 200000)
        throw new GeometryError(
          "RESOURCE_LIMIT",
          "Слишком много вершин для проверки перемещения.",
        );
      if (length(subtract(world(a.position), world(b.position))) <= tolerance)
        throw new GeometryError(
          "DEGENERATE",
          "Перемещение совмещает разные вершины. Автоматическое слияние пока не поддерживается.",
          [a.id, b.id],
        );
    }
  // A free edge can pierce a face without touching any boundary edge.
  // Test the canonical face region too, including holes, before accepting it.
  let facePairs = 0;
  for (const face of Object.values(after.faces)) {
    const lids = [face.outerLoopId, ...face.innerLoopIds],
      uses = lids.flatMap((l) =>
        after.loops[l].coedgeIds.map((c) => after.coedges[c]),
      ),
      faceEdges = new Set(uses.map((c) => c.edgeId)),
      faceVertices = new Set(
        uses.flatMap((c) => [
          after.edges[c.edgeId].start,
          after.edges[c.edgeId].end,
        ]),
      ),
      plane = contextPlane(face.plane, context);
    const polygons = lids.map((l) =>
      after.loops[l].coedgeIds.map((cid) => {
        const c = after.coedges[cid],
          e = after.edges[c.edgeId];
        return projectPoint(
          world(after.vertices[c.direction === 1 ? e.start : e.end].position),
          plane,
        );
      }),
    );
    for (const edge of edges) {
      if (
        faceEdges.has(edge.id) ||
        (!moved.has(edge.id) && !affected.has(face.id))
      )
        continue;
      if (++facePairs > 200000)
        throw new GeometryError(
          "RESOURCE_LIMIT",
          "Превышен бюджет проверки контактов граней.",
        );
      const a = world(after.vertices[edge.start].position),
        b = world(after.vertices[edge.end].position),
        da = dot(subtract(a, plane.origin), plane.normal),
        db = dot(subtract(b, plane.origin), plane.normal),
        points: Vec3[] = [];
      if (Math.abs(da) <= tolerance && Math.abs(db) <= tolerance)
        points.push(a, b, multiply(add(a, b), 0.5));
      else if (
        da * db <= 0 ||
        Math.abs(da) <= tolerance ||
        Math.abs(db) <= tolerance
      ) {
        const t =
          Math.abs(da - db) > 1e-15
            ? Math.max(0, Math.min(1, da / (da - db)))
            : 0;
        points.push(add(a, multiply(subtract(b, a), t)));
      }
      for (const point of points)
        if (
          inRegion(
            projectPoint(point, plane),
            polygons[0],
            polygons.slice(1),
          ) &&
          ![edge.start, edge.end].some(
            (v) =>
              faceVertices.has(v) &&
              length(subtract(point, world(after.vertices[v].position))) <=
                tolerance,
          )
        )
          throw new GeometryError(
            "UNSUPPORTED_OPERATION",
            "Перемещённое ребро пересекает грань без топологического соединения.",
            [edge.id, face.id],
          );
    }
  }
  assertFaceContacts(after, affected, context, "Перемещение");

  const forward = diffGeometry(before, after);
  return { forward, inverse: invertDelta(forward), lineage };
}

export function prepareVertexMove(
  model: GeometryModel,
  positions: { vertexId: Id<"vertex">; position: Vec3 }[],
  context: ValidationContext,
  operationId: Id<"operation"> = id("direct-vertex-move"),
) {
  validateGeometry(model, context);

  if (!Array.isArray(positions) || positions.length > 4096)
    throw new GeometryError(
      "RESOURCE_LIMIT",
      "Слишком много вершин перемещения.",
    );

  const after = structuredClone(model),
    changed = new Set<string>(),
    seen = new Set<string>();

  for (const m of positions) {
    assertVector(m.position);

    if (!after.vertices[m.vertexId] || seen.has(m.vertexId))
      throw new GeometryError(
        "INVALID_TOPOLOGY",
        "Неизвестная или повторная вершина.",
        [m.vertexId],
      );

    seen.add(m.vertexId);
    if (length(subtract(after.vertices[m.vertexId].position, m.position)) === 0)
      continue;

    changed.add(m.vertexId);
    after.vertices[m.vertexId].position = [...m.position];
  }

  const lineage = foldMovedFaces(model, after, changed, context, operationId);
  return finish(model, after, changed, context, lineage);
}

export function prepareEntityTranslation(
  model: GeometryModel,
  entities: MoveEntity[],
  delta: Vec3,
  copy: boolean,
  context: ValidationContext,
  operationId: Id<"operation">,
) {
  validateGeometry(model, context);
  assertVector(delta);

  const selection = moveSelection(model, entities),
    { world, local, tolerance } = metric(model, context);

  if (length(delta) <= tolerance) {
    if (copy)
      throw new GeometryError(
        "DEGENERATE",
        "Укажите ненулевое смещение копии.",
      );

    const forward = diffGeometry(model, model);
    return { forward, inverse: invertDelta(forward), lineage: [] };
  }

  const position = (v: Id<"vertex">) =>
    local(add(world(model.vertices[v].position), delta));

  if (!copy)
    return prepareVertexMove(
      model,
      [...selection.vertices].map((vertexId) => ({
        vertexId,
        position: position(vertexId),
      })),
      context,
      operationId,
    );

  const after = structuredClone(model),
    allocate = createIdAllocator(operationId, [
      ...entityTables.flatMap((t) => Object.keys(model[t])),
      ...(context.reservedIds ?? []),
    ]),
    vm = new Map<Id<"vertex">, Id<"vertex">>(),
    em = new Map<Id<"edge">, Id<"edge">>(),
    fm = new Map<Id<"face">, Id<"face">>();

  for (const v of selection.vertices) {
    const id = allocate("vertex");
    vm.set(v, id);
    after.vertices[id] = { ...model.vertices[v], id, position: position(v) };
  }

  for (const e of selection.edges) {
    const id = allocate("edge"),
      source = model.edges[e];
    em.set(e, id);
    after.edges[id] = {
      ...source,
      id,
      start: vm.get(source.start)!,
      end: vm.get(source.end)!,
    };
  }

  for (const v of vm.values())
    if (!Object.values(after.edges).some((e) => e.start === v || e.end === v))
      after.vertices[v].role = "construction";

  for (const fid of selection.faces) {
    const source = model.faces[fid],
      id = allocate("face");
    fm.set(fid, id);

    const lids = [source.outerLoopId, ...source.innerLoopIds].map((lid) => {
      const l = allocate("loop"),
        coedgeIds = model.loops[lid].coedgeIds.map((cid) => {
          const c = allocate("coedge"),
            co = model.coedges[cid];
          after.coedges[c] = {
            ...co,
            id: c,
            loopId: l,
            edgeId: em.get(co.edgeId)!,
          };
          return c;
        });
      after.loops[l] = { id: l, coedgeIds };
      return l;
    });

    after.faces[id] = {
      ...structuredClone(source),
      id,
      outerLoopId: lids[0],
      innerLoopIds: lids.slice(1),
    };
  }

  for (const shell of Object.values(model.shells))
    if (shell.faces.every((f) => fm.has(f.faceId))) {
      const id = allocate("shell");
      after.shells[id] = {
        id,
        faces: shell.faces.map((f) => ({ ...f, faceId: fm.get(f.faceId)! })),
      };
    }

  rebuildBodies(after, model, allocate, new Map());

  return finish(model, after, new Set(vm.values()), context);
}
