import earcut from "earcut";
import { GeometryError, type Vec2, type Vec3 } from "./model";
import { orientation } from "./predicates";
import { cross, subtract, length } from "./math";
import { signedArea, inRegion } from "./sketch-common";
import { mergeFoldTriangles, type FoldRegion } from "./fold-regions";
const edgeKey = (a: number, b: number) => (a < b ? a + ":" + b : b + ":" + a);
/** Canonical loop inputs, independently certified planar triangulation.
 * No render DTOs or meshes participate in topology construction. */
export function foldHoledRegions(
  projected: Vec2[],
  points: Vec3[],
  ids: string[],
  rings: number[][],
  tolerance: number,
  budget: { remaining: number },
  changed: ReadonlySet<string>,
): FoldRegion[] {
  if (projected.length > 128 || rings.length > 17)
    throw new GeometryError(
      "RESOURCE_LIMIT",
      "Сгиб: до 128 граничных вершин и 16 отверстий.",
    );
  const step = () => {
    if (--budget.remaining < 0)
      throw new GeometryError(
        "RESOURCE_LIMIT",
        "Превышен бюджет сгиба с отверстиями.",
      );
  };
  const sign = (a: number, b: number, c: number) => {
    step();
    return orientation(projected[a], projected[b], projected[c]);
  };
  const sourceArea = rings.reduce(
      (n, r) => n + signedArea(r.map((i) => projected[i])),
      0,
    ),
    working = rings.map((r) => [...r]),
    triangles: number[][] = [];
  // Localise an outer-corner fold when its ear is wholly outside every hole.
  // This keeps a distant unchanged opening within one unchanged planar patch.
  while (working[0].length > 3) {
    const outer = working[0],
      candidates = outer
        .map((b, k) => ({
          a: outer[(k + outer.length - 1) % outer.length],
          b,
          c: outer[(k + 1) % outer.length],
          k,
        }))
        .filter((t) => changed.has(ids[t.b]) && sign(t.a, t.b, t.c) > 0)
        .sort((a, b) =>
          ids[a.b] < ids[b.b] ? -1 : ids[a.b] > ids[b.b] ? 1 : 0,
        );
    const ear = candidates.find(
      (t) =>
        !working
          .flat()
          .some(
            (i) =>
              i !== t.a &&
              i !== t.b &&
              i !== t.c &&
              sign(t.a, t.b, i) >= 0 &&
              sign(t.b, t.c, i) >= 0 &&
              sign(t.c, t.a, i) >= 0,
          ),
    );
    if (!ear) break;
    triangles.push([ear.a, ear.b, ear.c]);
    outer.splice(ear.k, 1);
  }
  const input = working.flat(),
    holes = working
      .slice(1)
      .map((_, i) => working.slice(0, i + 1).reduce((n, r) => n + r.length, 0)),
    indices = earcut(
      input.flatMap((i) => projected[i]),
      holes,
      2,
    );
  if (!indices.length || indices.length % 3)
    throw new GeometryError(
      "NUMERICAL_AMBIGUITY",
      "Не удалось разделить грань с отверстиями.",
    );
  for (let i = 0; i < indices.length; i += 3) {
    const t = indices.slice(i, i + 3).map((i) => input[i]);
    if (
      t.some((v) => !Number.isInteger(v) || v < 0 || v >= projected.length) ||
      new Set(t).size !== 3
    )
      throw new GeometryError(
        "INVALID_TOPOLOGY",
        "Некорректный участок разбиения.",
      );
    if (sign(t[0], t[1], t[2]) < 0) [t[1], t[2]] = [t[2], t[1]];
    triangles.push(t);
  }
  const boundary = new Map<string, [number, number]>();
  for (const r of rings)
    for (let i = 0; i < r.length; i++)
      boundary.set(edgeKey(r[i], r[(i + 1) % r.length]), [
        r[i],
        r[(i + 1) % r.length],
      ]);
  // Earcut may filter collinear boundary vertices. Restore them with constrained
  // source-boundary chains; the third triangle vertex fans the restored edge.
  const chain = (a: number, b: number) => {
    for (const r of rings) {
      const ia = r.indexOf(a),
        ib = r.indexOf(b);
      if (ia < 0 || ib < 0) continue;
      for (const dir of [1, -1]) {
        const path = [a];
        for (
          let k = (ia + dir + r.length) % r.length;
          k !== ib;
          k = (k + dir + r.length) % r.length
        )
          path.push(r[k]);
        path.push(b);
        if (path.length <= 2) continue;
        const pa = projected[a],
          pb = projected[b],
          dx = pb[0] - pa[0],
          dy = pb[1] - pa[1],
          size = Math.hypot(dx, dy);
        let previous = 0,
          valid = true;
        for (const v of path.slice(1, -1)) {
          step();
          const p = projected[v],
            distance =
              Math.abs((p[0] - pa[0]) * dy - (p[1] - pa[1]) * dx) / size,
            t = ((p[0] - pa[0]) * dx + (p[1] - pa[1]) * dy) / (size * size);
          if (distance > tolerance || t <= previous || t >= 1) {
            valid = false;
            break;
          }
          previous = t;
        }
        if (valid) return path;
      }
    }
    return null;
  };
  for (let changed = true; changed;) {
    changed = false;
    outer: for (let i = 0; i < triangles.length; i++)
      for (let k = 0; k < 3; k++) {
        step();
        const t = triangles[i],
          a = t[k],
          b = t[(k + 1) % 3],
          d = t[(k + 2) % 3];
        if (boundary.has(edgeKey(a, b))) continue;
        const path = chain(a, b);
        if (!path) continue;
        triangles.splice(
          i,
          1,
          ...path.slice(0, -1).map((v, j) => [v, path[j + 1], d]),
        );
        changed = true;
        break outer;
      }
    if (triangles.length > 512)
      throw new GeometryError(
        "RESOURCE_LIMIT",
        "Слишком много участков сгиба.",
      );
  }
  const uses = new Map<string, [number, number][]>();
  let covered = 0;
  for (const t of triangles) {
    if (sign(t[0], t[1], t[2]) <= 0)
      throw new GeometryError(
        "DEGENERATE",
        "Вырожденный участок вокруг отверстия.",
      );
    const flat = t.map((i) => projected[i]),
      area = signedArea(flat),
      center: Vec2 = [
        flat.reduce((n, p) => n + p[0], 0) / 3,
        flat.reduce((n, p) => n + p[1], 0) / 3,
      ];
    covered += area;
    if (
      !inRegion(
        center,
        rings[0].map((i) => projected[i]),
        rings.slice(1).map((r) => r.map((i) => projected[i])),
      )
    )
      throw new GeometryError(
        "INVALID_TOPOLOGY",
        "Разбиение заполняет отверстие или выходит за контур.",
      );
    if (
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
        "Сгиб схлопывает участок около отверстия.",
      );
    for (let k = 0; k < 3; k++) {
      const a = t[k],
        b = t[(k + 1) % 3],
        key = edgeKey(a, b);
      uses.set(key, [...(uses.get(key) ?? []), [a, b]]);
    }
  }
  if (
    Math.abs(covered - sourceArea) >
    Math.max(tolerance * tolerance, Math.abs(sourceArea) * 1e-10)
  )
    throw new GeometryError(
      "NUMERICAL_AMBIGUITY",
      "Не подтверждена площадь исходной грани с отверстиями.",
    );
  for (const [key, expected] of boundary) {
    const list = uses.get(key);
    if (
      !list ||
      list.length !== 1 ||
      list[0][0] !== expected[0] ||
      list[0][1] !== expected[1]
    )
      throw new GeometryError(
        "INVALID_TOPOLOGY",
        "Потеряна граница исходного отверстия или внешнего контура.",
      );
  }
  for (const [key, list] of uses)
    if (
      !boundary.has(key) &&
      (list.length !== 2 ||
        list[0][0] !== list[1][1] ||
        list[0][1] !== list[1][0])
    )
      throw new GeometryError(
        "INVALID_TOPOLOGY",
        "Несогласованные внутренние рёбра вокруг отверстия.",
      );
  if (new Set(triangles.flat()).size !== ids.length)
    throw new GeometryError(
      "INVALID_TOPOLOGY",
      "Разбиение потеряло граничную вершину.",
    );
  return mergeFoldTriangles(triangles, points, ids, tolerance);
}
