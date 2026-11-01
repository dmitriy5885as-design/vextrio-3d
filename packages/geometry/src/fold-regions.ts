import { GeometryError, type Vec2, type Vec3 } from "./model";
import { orientation } from "./predicates";
import { cross, subtract, dot, length, projectPoint } from "./math";
import { unit, signedArea } from "./sketch-common";
const key = (a: number, b: number) => (a < b ? a + ":" + b : b + ":" + a);
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Constrained ears retain every boundary vertex, including collinear ones.
 * Adjacent coplanar pieces are reunited before creating canonical entities. */
export function foldRegions(
  projected: Vec2[],
  points: Vec3[],
  ids: string[],
  changed: ReadonlySet<string>,
  tolerance: number,
  budget: { remaining: number } = { remaining: 200000 },
) {
  if (projected.length < 3 || projected.length > 128)
    throw new GeometryError(
      "RESOURCE_LIMIT",
      "Автоскладывание: от 3 до 128 вершин контура.",
    );
  const sign = (a: Vec2, b: Vec2, c: Vec2) => {
    if (--budget.remaining < 0)
      throw new GeometryError(
        "RESOURCE_LIMIT",
        "Превышен бюджет поиска диагоналей сгиба.",
      );
    const x = (b[0] - a[0]) * (c[1] - a[1]),
      y = (b[1] - a[1]) * (c[0] - a[0]),
      det = x - y;
    // Filter only safely separated determinant signs; uncertain cases use the
    // existing exact binary64 predicate, including collinear boundary points.
    return Math.abs(det) > 1e-14 * (Math.abs(x) + Math.abs(y))
      ? det > 0
        ? 1
        : -1
      : orientation(a, b, c);
  };
  const active = projected.map((_, i) => i),
    triangles: number[][] = [];
  while (active.length > 3) {
    const candidates = active
      .map((b, k) => {
        const a = active[(k + active.length - 1) % active.length],
          c = active[(k + 1) % active.length];
        return {
          a,
          b,
          c,
          k,
          cost: Number(changed.has(ids[a])) + Number(changed.has(ids[c])),
          center: changed.has(ids[b]) ? 0 : 1,
          size: length(subtract(points[a], points[c])),
          id: [ids[a], ids[c]].sort().join("|") + "/" + ids[b],
        };
      })
      .filter((t) => sign(projected[t.a], projected[t.b], projected[t.c]) > 0)
      .sort(
        (a, b) =>
          a.cost - b.cost ||
          a.center - b.center ||
          a.size - b.size ||
          compare(a.id, b.id),
      );
    const ear = candidates.find(
      (t) =>
        !active.some(
          (i) =>
            i !== t.a &&
            i !== t.b &&
            i !== t.c &&
            sign(projected[t.a], projected[t.b], projected[i]) >= 0 &&
            sign(projected[t.b], projected[t.c], projected[i]) >= 0 &&
            sign(projected[t.c], projected[t.a], projected[i]) >= 0,
        ),
    );
    if (!ear)
      throw new GeometryError(
        "NUMERICAL_AMBIGUITY",
        "Не удалось устойчиво разделить контур для сгиба.",
      );
    triangles.push([ear.a, ear.b, ear.c]);
    active.splice(ear.k, 1);
  }
  triangles.push([...active]);
  for (const t of triangles)
    if (
      sign(projected[t[0]], projected[t[1]], projected[t[2]]) <= 0 ||
      length(
        cross(
          subtract(points[t[1]], points[t[0]]),
          subtract(points[t[2]], points[t[0]]),
        ),
      ) <=
        tolerance * tolerance
    )
      throw new GeometryError(
        "DEGENERATE",
        "Сгиб создаёт вырожденный участок.",
      );
  return mergeFoldTriangles(triangles, points, ids, tolerance).map((region) => {
    if (region.holes.length)
      throw new GeometryError(
        "INVALID_TOPOLOGY",
        "Простой контур неожиданно получил отверстие.",
      );
    return region.outer;
  });
}
export interface FoldRegion {
  outer: number[];
  holes: number[][];
}
export function mergeFoldTriangles(
  triangles: number[][],
  points: Vec3[],
  ids: string[],
  tolerance: number,
): FoldRegion[] {
  let groups = triangles.map((t) => [t]);
  const boundary = (group: number[][]) => {
    const edges = new Map<string, [number, number][]>();
    for (const t of group)
      for (let i = 0; i < 3; i++) {
        const a = t[i],
          b = t[(i + 1) % 3],
          k = key(a, b);
        edges.set(k, [...(edges.get(k) ?? []), [a, b]]);
      }
    return [...edges.values()].filter((e) => e.length === 1).map((e) => e[0]);
  };
  for (let merged = true; merged;) {
    merged = false;
    outer: for (let i = 0; i < groups.length; i++)
      for (let j = i + 1; j < groups.length; j++) {
        const a = boundary(groups[i]),
          b = boundary(groups[j]);
        if (!a.some((e) => b.some((f) => e[0] === f[1] && e[1] === f[0])))
          continue;
        const triangle = groups[i][0],
          origin = points[triangle[0]],
          normal = unit(
            cross(
              subtract(points[triangle[1]], origin),
              subtract(points[triangle[2]], origin),
            ),
          ),
          vertices = [...new Set([...groups[i], ...groups[j]].flat())];
        if (
          vertices.some(
            (v) =>
              Math.abs(dot(subtract(points[v], origin), normal)) > tolerance,
          )
        )
          continue;
        if (
          groups[j].some(
            (t) =>
              dot(
                cross(
                  subtract(points[t[1]], points[t[0]]),
                  subtract(points[t[2]], points[t[0]]),
                ),
                normal,
              ) <= 0,
          )
        )
          continue;
        const joined = [...groups[i], ...groups[j]],
          rim = boundary(joined);
        if (
          new Set(rim.map((e) => e[0])).size !== rim.length ||
          new Set(rim.map((e) => e[1])).size !== rim.length
        )
          continue;
        groups[i] = joined;
        groups.splice(j, 1);
        merged = true;
        break outer;
      }
  }
  const regions = groups.map((group) => {
    const edges = boundary(group).sort((a, b) => compare(ids[a[0]], ids[b[0]])),
      next = new Map(edges.map((e) => [e[0], e[1]])),
      pending = new Set(edges.map((e) => e[0])),
      rings: number[][] = [];
    if (
      next.size !== edges.length ||
      new Set(edges.map((e) => e[1])).size !== edges.length
    )
      throw new GeometryError(
        "INVALID_TOPOLOGY",
        "Граница участка сгиба неоднозначна.",
      );
    while (pending.size) {
      const start = pending.values().next().value!,
        ring = [start];
      pending.delete(start);
      while (next.get(ring[ring.length - 1]) !== start) {
        const v = next.get(ring[ring.length - 1]);
        if (v === undefined || !pending.has(v) || ring.length >= edges.length)
          throw new GeometryError(
            "INVALID_TOPOLOGY",
            "Незамкнутый участок сгиба.",
          );
        ring.push(v);
        pending.delete(v);
      }
      if (ring.length < 3)
        throw new GeometryError(
          "DEGENERATE",
          "Слишком короткая граница сгиба.",
        );
      rings.push(ring);
    }
    const t = group[0],
      origin = points[t[0]],
      u = unit(subtract(points[t[1]], origin)),
      normal = unit(
        cross(subtract(points[t[1]], origin), subtract(points[t[2]], origin)),
      ),
      plane = { origin, u, v: cross(normal, u), normal };
    const areas = rings.map((r) =>
      signedArea(r.map((i) => projectPoint(points[i], plane))),
    );
    if (areas.some((a) => Math.abs(a) <= tolerance * tolerance))
      throw new GeometryError(
        "DEGENERATE",
        "Сгиб схлопывает границу отверстия.",
      );
    const outer = rings.filter((_, i) => areas[i] > 0),
      holes = rings.filter((_, i) => areas[i] < 0);
    if (outer.length !== 1)
      throw new GeometryError(
        "INVALID_TOPOLOGY",
        "Участок сгиба имеет несколько внешних контуров.",
      );
    return { outer: outer[0], holes };
  });
  if (regions.length < 2)
    throw new GeometryError(
      "NUMERICAL_AMBIGUITY",
      "Сгиб находится на границе численного допуска.",
    );
  return regions;
}
