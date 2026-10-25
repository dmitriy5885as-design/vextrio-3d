import {
  GeometryError,
  type GeometryModel,
  type Id,
  type PlaneFrame,
  type Vec2,
  type Vec3,
} from "./model";
import {
  cross,
  length,
  projectPoint,
  transformPlane,
  unprojectPoint,
} from "./math";
import { orientation } from "./predicates";
import {
  inRegion,
  onPlane,
  planeThrough,
  signedArea,
  witness,
} from "./sketch-common";
import type { ValidationContext } from "./validate";
export interface Boundary {
  uses: { edgeId: Id<"edge">; direction: 1 | -1 }[];
  points: Vec2[];
  vertexIds: Id<"vertex">[];
  area: number;
}
export interface Cell {
  plane: PlaneFrame;
  outer: Boundary;
  holes: Boundary[];
  sample: Vec3;
}
export function discoverPlanes(
  model: GeometryModel,
  world: (p: Vec3) => Vec3,
  tolerance: number,
  context: ValidationContext,
  declared: PlaneFrame | null = null,
): PlaneFrame[] {
  const planes: PlaneFrame[] = [],
    edges = Object.values(model.edges);
  function include(p: PlaneFrame) {
    if (
      !planes.some(
        (q) =>
          length(cross(p.normal, q.normal)) <=
            (context.policy?.angular ?? 1e-10) &&
          onPlane(p.origin, q, tolerance) &&
          onPlane(q.origin, p, tolerance),
      )
    ) {
      if (planes.length >= 64)
        throw new GeometryError(
          "RESOURCE_LIMIT",
          "At most 64 support planes in the reference arrangement",
        );
      planes.push(p);
    }
  }
  for (const f of Object.values(model.faces))
    include(
      context.placement ? transformPlane(f.plane, context.placement) : f.plane,
    );
  if (declared)
    include(
      context.placement
        ? transformPlane(declared, context.placement)
        : declared,
    );
  // Candidate planes from pairs, then full containment of relevant edges. No
  // plane is inferred by simply dropping a coordinate of a spatial contour.
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length; j++) {
      const a = world(model.vertices[edges[i].start].position),
        b = world(model.vertices[edges[i].end].position),
        c = world(model.vertices[edges[j].start].position),
        d = world(model.vertices[edges[j].end].position);
      const p =
        planeThrough(a, b, c, tolerance) ?? planeThrough(a, b, d, tolerance);
      if (p && onPlane(d, p, tolerance)) include(p);
    }
  return planes;
}
export function planeCells(
  model: GeometryModel,
  plane: PlaneFrame,
  world: (p: Vec3) => Vec3,
  tolerance: number,
): Cell[] {
  const edges = Object.values(model.edges).filter(
    (e) =>
      onPlane(world(model.vertices[e.start].position), plane, tolerance) &&
      onPlane(world(model.vertices[e.end].position), plane, tolerance),
  );
  const adjacency = new Map<string, { edge: string; other: string }[]>();
  for (const e of edges)
    for (const [a, b] of [
      [e.start, e.end],
      [e.end, e.start],
    ]) {
      const list = adjacency.get(a) ?? [];
      list.push({ edge: e.id, other: b });
      adjacency.set(a, list);
    }
  // Tarjan bridges remove spurs and bridges between rings before face walks.
  const discovery = new Map<string, number>(),
    low = new Map<string, number>(),
    bridges = new Set<string>();
  let clock = 0;
  function dfs(v: string, parent: string | null) {
    discovery.set(v, ++clock);
    low.set(v, clock);
    for (const n of adjacency.get(v) ?? []) {
      if (n.edge === parent) continue;
      if (!discovery.has(n.other)) {
        dfs(n.other, n.edge);
        low.set(v, Math.min(low.get(v)!, low.get(n.other)!));
        if (low.get(n.other)! > discovery.get(v)!) bridges.add(n.edge);
      } else low.set(v, Math.min(low.get(v)!, discovery.get(n.other)!));
    }
  }
  for (const v of adjacency.keys()) if (!discovery.has(v)) dfs(v, null);
  const positions = new Map<string, Vec2>();
  for (const v of adjacency.keys())
    positions.set(v, projectPoint(world(model.vertices[v].position), plane));
  const outgoing = new Map<
    string,
    { edgeId: Id<"edge">; direction: 1 | -1; to: Id<"vertex"> }[]
  >();
  for (const e of edges)
    if (!bridges.has(e.id))
      for (const [from, to, direction] of [
        [e.start, e.end, 1],
        [e.end, e.start, -1],
      ] as const) {
        const list = outgoing.get(from) ?? [];
        list.push({ edgeId: e.id, direction, to });
        outgoing.set(from, list);
      }
  for (const [v, list] of outgoing) {
    const origin = positions.get(v)!;
    list.sort((a, b) => {
      const pa = positions.get(a.to)!,
        pb = positions.get(b.to)!,
        u: Vec2 = [pa[0] - origin[0], pa[1] - origin[1]],
        w: Vec2 = [pb[0] - origin[0], pb[1] - origin[1]],
        half = (p: Vec2) => (p[1] > 0 || (p[1] === 0 && p[0] >= 0) ? 0 : 1);
      const h = half(u) - half(w);
      if (h) return h;
      const sign = orientation([0, 0], u, w);
      if (sign) return -sign;
      throw new GeometryError(
        "NUMERICAL_AMBIGUITY",
        "Unsplit collinear outgoing edges",
      );
    });
  }
  const visited = new Set<string>(),
    boundaries: Boundary[] = [];
  for (const [from, list] of outgoing)
    for (const first of list) {
      const firstKey = first.edgeId + ":" + first.direction;
      if (visited.has(firstKey)) continue;
      let current = first,
        vertex = from;
      const uses: Boundary["uses"] = [],
        points: Vec2[] = [],
        vertexIds: Id<"vertex">[] = [];
      for (let steps = 0; ; steps++) {
        if (steps > 2 * edges.length)
          throw new GeometryError(
            "INVALID_TOPOLOGY",
            "Arrangement walk did not close",
          );
        const key = current.edgeId + ":" + current.direction;
        if (visited.has(key)) {
          if (key !== firstKey)
            throw new GeometryError(
              "INVALID_TOPOLOGY",
              "Arrangement walk joined another cycle",
            );
          break;
        }
        visited.add(key);
        uses.push({ edgeId: current.edgeId, direction: current.direction });
        points.push(positions.get(vertex)!);
        vertexIds.push(vertex as Id<"vertex">);
        vertex = current.to;
        const next = outgoing.get(vertex)!,
          index = next.findIndex(
            (n) =>
              n.edgeId === current.edgeId && n.direction === -current.direction,
          );
        if (index < 0)
          throw new GeometryError("INVALID_TOPOLOGY", "Missing planar twin");
        current = next[(index + next.length - 1) % next.length];
      }
      const area = signedArea(points);
      if (area > tolerance * tolerance) {
        if (new Set(vertexIds).size !== vertexIds.length)
          throw new GeometryError(
            "NUMERICAL_AMBIGUITY",
            "Non-simple bounded face boundary",
          );
        boundaries.push({ uses, points, vertexIds, area });
      }
    }
  const parents = boundaries.map((b, i) => {
    let best = -1;
    for (let j = 0; j < boundaries.length; j++) {
      const p = boundaries[j];
      if (
        i !== j &&
        p.area > b.area &&
        b.points.every((v) => inRegion(v, p.points)) &&
        (best < 0 || p.area < boundaries[best].area)
      )
        best = j;
    }
    return best;
  });
  return boundaries.map((outer, i) => {
    const holes = boundaries.filter((_, j) => parents[j] === i);
    const sample = unprojectPoint(
      witness(
        outer.points,
        holes.map((h) => h.points),
      ),
      plane,
    );
    return { plane, outer, holes, sample };
  });
}
