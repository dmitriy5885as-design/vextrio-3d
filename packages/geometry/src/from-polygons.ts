import {
  emptyGeometry,
  createIdAllocator,
  id,
  defaultPolicy,
  type GeometryModel,
  type Vec3,
  type Id,
} from "./model";
import { cross, subtract, dot, length } from "./math";
import { validateGeometry } from "./validate";
import { rebuildBodies } from "./sketch";
import { tessellateFace } from "./tessellate";
export interface PolygonData {
  positions: Vec3[];
  polygons: number[][];
  lines?: number[][];
}
export const MAX_IMPORT_FACES = 3000;
// Canonical topology is built from source coordinates, never renderer meshes.
// Import is bounded and rejects malformed/degenerate data instead of dropping it.
export function geometryFromPolygons(
  data: PolygonData,
  namespace: string,
  owner: Id<"definition">,
  material: Id<"material">,
): GeometryModel {
  if (
    data.positions.length > 15000 ||
    data.polygons.length > MAX_IMPORT_FACES ||
    (data.lines?.length ?? 0) > 10000
  )
    throw Error(
      "Модель слишком большая: максимум 3000 граней и 15000 вершин для редактируемого импорта.",
    );
  if (!data.positions.length || (!data.polygons.length && !data.lines?.length))
    throw Error("В файле нет геометрии.");
  const model = emptyGeometry(id<"geometry">(namespace + "/geometry"), owner),
    before = structuredClone(model),
    allocate = createIdAllocator(id<"operation">(namespace + "/import"));
  const tol = defaultPolicy.absoluteDistance,
    bins = new Map<string, Id<"vertex">[]>();
  const vertices = data.positions.map((position) => {
    if (
      position.length !== 3 ||
      position.some((n) => !Number.isFinite(n) || Math.abs(n) > 1e7)
    )
      throw Error("Неверные координаты модели.");
    const q = position.map((n) => Math.floor(n / tol));
    for (let x = -1; x <= 1; x++)
      for (let y = -1; y <= 1; y++)
        for (let z = -1; z <= 1; z++)
          for (const key of bins.get([q[0] + x, q[1] + y, q[2] + z].join()) ??
            [])
            if (length(subtract(position, model.vertices[key].position)) <= tol)
              return key;
    const vid = allocate("vertex"),
      bin = q.join();
    model.vertices[vid] = { id: vid, position: [...position] };
    bins.set(bin, [...(bins.get(bin) ?? []), vid]);
    return vid;
  });
  const read = (i: number) => {
    if (!Number.isInteger(i) || i < 0 || i >= vertices.length)
      throw Error("Индекс вершины вне диапазона.");
    return vertices[i];
  };
  const edges = new Map<string, Id<"edge">>();
  const edge = (a: Id<"vertex">, b: Id<"vertex">) => {
    if (a === b) throw Error("Вырожденное ребро модели.");
    const key = [a, b].sort().join("|");
    let eid = edges.get(key);
    if (!eid) {
      eid = allocate("edge");
      model.edges[eid] = { id: eid, start: a, end: b, curve: { kind: "line" } };
      edges.set(key, eid);
    }
    return eid;
  };
  const knownFaces = new Set<string>();
  for (const polygon of data.polygons) {
    if (polygon.length < 3 || polygon.length > 256)
      throw Error("Грань должна иметь от 3 до 256 вершин.");
    const ring = polygon.map(read);
    if (new Set(ring).size !== ring.length)
      throw Error("Грань содержит совпадающие вершины.");
    const faceKey = [...ring].sort().join("|");
    if (knownFaces.has(faceKey)) throw Error("Дублирующаяся грань модели.");
    knownFaces.add(faceKey);
    const origin = model.vertices[ring[0]].position,
      first = subtract(model.vertices[ring[1]].position, origin),
      norm = length(first),
      u = first.map((n) => n / norm) as Vec3;
    let normal: Vec3 = [0, 0, 0];
    for (let i = 2; i < ring.length; i++) {
      normal = cross(first, subtract(model.vertices[ring[i]].position, origin));
      if (length(normal) > tol * norm) break;
    }
    const n = length(normal);
    if (n <= tol * norm) throw Error("Вырожденная грань модели.");
    normal = normal.map((v) => v / n) as Vec3;
    const v = cross(normal, u);
    if (
      ring.some(
        (key) =>
          Math.abs(
            dot(subtract(model.vertices[key].position, origin), normal),
          ) > tol,
      )
    )
      throw Error(
        "Неплоская грань: предварительно триангулируйте модель в исходной программе.",
      );
    const lid = allocate("loop"),
      fid = allocate("face"),
      coedgeIds = ring.map((a, i) => {
        const eid = edge(a, ring[(i + 1) % ring.length]),
          cid = allocate("coedge");
        model.coedges[cid] = {
          id: cid,
          edgeId: eid,
          loopId: lid,
          direction: model.edges[eid].start === a ? 1 : -1,
        };
        return cid;
      });
    model.loops[lid] = { id: lid, coedgeIds };
    model.faces[fid] = {
      id: fid,
      plane: { origin: [...origin], u, v, normal },
      outerLoopId: lid,
      innerLoopIds: [],
      frontMaterialId: material,
      backMaterialId: material,
    };
    tessellateFace(model, model.faces[fid]);
  }
  for (const line of data.lines ?? [])
    for (let i = 1; i < line.length; i++)
      edge(read(line[i - 1]), read(line[i]));
  // Vertices unused by any edge are not imported as misleading loose data.
  const used = new Set(
    Object.values(model.edges).flatMap((e) => [e.start, e.end]),
  );
  for (const key of Object.keys(model.vertices))
    if (!used.has(key as Id<"vertex">)) delete model.vertices[key];
  rebuildBodies(model, before, allocate, new Map());
  const normalized = JSON.parse(JSON.stringify(model)) as GeometryModel;
  validateGeometry(normalized, {
    ownerDefinitionId: owner,
    materialIds: new Set([material]),
  });
  return normalized;
}
