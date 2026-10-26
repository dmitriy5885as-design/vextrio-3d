import type { Vec3 } from "@forma/shared";
import {
  definitionOccurrences,
  type ProjectV2,
  type EntityRef,
} from "@forma/document";
import {
  add,
  subtract,
  multiply,
  dot,
  cross,
  length,
  transformAffine,
  affinePlane,
  segmentIntersections,
  distanceTolerance,
  type GeometryPolicy,
  assertVector,
  validatePlane,
} from "@forma/geometry";
import { normalize, rayOnPlane, type WorkPlane } from "./precision";
export type SnapKind =
  | "vertex"
  | "endpoint"
  | "midpoint"
  | "edge"
  | "face"
  | "intersection"
  | "axis"
  | "grid"
  | "origin"
  | "parallel"
  | "perpendicular";
export interface Projection {
  x: number;
  y: number;
  depth: number;
  visible: boolean;
  w: number;
  clipZ?: number;
  nearPlane?: number;
  farPlane?: number;
}
export interface SnapCandidate {
  key: string;
  kind: SnapKind;
  point: Vec3;
  distance: number;
  depth: number;
  ref?: EntityRef;
  label: string;
  guide?: [Vec3, Vec3];
}
export interface SnapQuery {
  cursor: [number, number];
  project: (p: Vec3) => Projection;
  ray: { origin: Vec3; direction: Vec3 };
  plane: WorkPlane;
  anchor: Vec3;
  axes: Vec3[];
  gridStep: number;
  enabled: boolean;
  perspective?: boolean;
  axis?: number | null;
  contextPath?: string[];
  contextOnly?: boolean;
  includeLocked?: boolean;
  radius?: number;
  releaseRadius?: number;
}
type Box = { min: Vec3; max: Vec3 };
type Source = {
  key: string;
  kind: "vertex" | "edge" | "face";
  points: Vec3[];
  holes?: Vec3[][];
  normal?: Vec3;
  ref: EntityRef;
  locked: boolean;
  degree?: number;
  box: Box;
  tolerance: number;
};
type Branch = { box: Box; left?: Branch; right?: Branch; items?: Source[] };
const boxOf = (points: Vec3[]): Box => ({
  min: [0, 1, 2].map((i) => Math.min(...points.map((p) => p[i]))) as Vec3,
  max: [0, 1, 2].map((i) => Math.max(...points.map((p) => p[i]))) as Vec3,
});
function merged(items: { box: Box }[]): Box {
  const box: Box = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
  for (const e of items)
    for (let i = 0; i < 3; i++) {
      box.min[i] = Math.min(box.min[i], e.box.min[i]);
      box.max[i] = Math.max(box.max[i], e.box.max[i]);
    }
  return box;
}
function build(items: Source[]): Branch | null {
  if (!items.length) return null;
  const box = merged(items);
  if (items.length <= 12) return { box, items };
  const axis = [0, 1, 2].sort(
    (a, b) => box.max[b] - box.min[b] - (box.max[a] - box.min[a]),
  )[0];
  items.sort(
    (a, b) =>
      a.box.min[axis] + a.box.max[axis] - (b.box.min[axis] + b.box.max[axis]) ||
      a.key.localeCompare(b.key),
  );
  const middle = Math.floor(items.length / 2);
  return {
    box,
    left: build(items.slice(0, middle))!,
    right: build(items.slice(middle))!,
  };
}
function nearby(box: Box, q: SnapQuery, radius: number): boolean {
  const corners = Array.from({ length: 8 }, (_, i) =>
    q.project(
      [0, 1, 2].map((j) => (i & (1 << j) ? box.max[j] : box.min[j])) as Vec3,
    ),
  );
  if (corners.every((p) => p.depth <= 0)) return false;
  if (
    corners.every((p) => p.clipZ !== undefined && p.clipZ > 1) ||
    corners.every((p) => p.clipZ !== undefined && p.clipZ < -1)
  )
    return false;
  // A box crossing the camera/near plane must be descended conservatively.
  if (corners.some((p) => !p.visible)) return true;
  return (
    q.cursor[0] >= Math.min(...corners.map((p) => p.x)) - radius &&
    q.cursor[0] <= Math.max(...corners.map((p) => p.x)) + radius &&
    q.cursor[1] >= Math.min(...corners.map((p) => p.y)) - radius &&
    q.cursor[1] <= Math.max(...corners.map((p) => p.y)) + radius
  );
}
const labels: Record<SnapKind, string> = {
  vertex: "Вершина",
  endpoint: "Конец отрезка",
  midpoint: "Середина ребра",
  edge: "На ребре",
  face: "На грани",
  intersection: "Пересечение",
  axis: "Ось",
  grid: "Сетка",
  origin: "Начало плоскости",
  parallel: "Параллельно ребру",
  perpendicular: "Перпендикулярно ребру",
};
const priority: Record<SnapKind, number> = {
  intersection: 0,
  vertex: 1,
  endpoint: 1,
  midpoint: 2,
  axis: 3,
  parallel: 4,
  perpendicular: 4,
  edge: 5,
  face: 6,
  grid: 7,
  origin: 2,
};
const samePath = (a: string[], b: string[]) =>
  a.length === b.length && a.every((n, i) => n === b[i]);
function inside(point: Vec3, polygon: Vec3[], normal: Vec3) {
  const drop = [0, 1, 2].sort(
      (a, b) => Math.abs(normal[b]) - Math.abs(normal[a]),
    )[0],
    axes = [0, 1, 2].filter((i) => i !== drop);
  const [x, y] = axes;
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (
      a[y] > point[y] !== b[y] > point[y] &&
      point[x] < ((b[x] - a[x]) * (point[y] - a[y])) / (b[y] - a[y]) + a[x]
    )
      result = !result;
  }
  return result;
}
function edgePoint(a: Vec3, b: Vec3, q: SnapQuery): Vec3 | null {
  for (const field of ["nearPlane", "farPlane"] as const) {
    const fa = q.project(a)[field],
      fb = q.project(b)[field];
    if (fa !== undefined && fb !== undefined) {
      if (fa < 0 && fb < 0) return null;
      if (fa < 0 || fb < 0) {
        const p = add(a, multiply(subtract(b, a), fa / (fa - fb)));
        if (fa < 0) a = p;
        else b = p;
      }
    }
  }
  const pa = q.project(a),
    pb = q.project(b);
  if (pa.depth <= 0 || pb.depth <= 0) return null;
  const dx = pb.x - pa.x,
    dy = pb.y - pa.y,
    denom = dx * dx + dy * dy;
  const s =
    denom > 1e-20
      ? Math.max(
          0,
          Math.min(
            1,
            ((q.cursor[0] - pa.x) * dx + (q.cursor[1] - pa.y) * dy) / denom,
          ),
        )
      : 0;
  // Perspective-correct interpolation, also valid for orthographic w=1.
  const t = s / pb.w / ((1 - s) / pa.w + s / pb.w);
  return add(a, multiply(subtract(b, a), t));
}
export class SnapEngine {
  private root: Branch | null;
  private previous: SnapCandidate | null = null;
  private acquired: Source[] = [];
  readonly sourceCount: number;
  readonly tolerance: number;
  private policy: GeometryPolicy;
  stats = { visited: 0, inspected: 0, tested: 0, pairs: 0, truncated: false };
  constructor(project: ProjectV2) {
    this.policy = project.geometryPolicy;
    const sources: Source[] = [];
    for (const occurrence of definitionOccurrences(project)) {
      const did = occurrence.definitionId,
        gid = project.definitions[did].geometryId;
      if (!occurrence.visible || !gid) continue;
      const g = project.geometries[gid],
        points = new Map<string, Vec3>(),
        degree = new Map<string, number>();
      for (const e of Object.values(g.edges))
        for (const id of [e.start, e.end])
          degree.set(id, (degree.get(id) ?? 0) + 1);
      for (const v of Object.values(g.vertices))
        points.set(
          v.id,
          transformAffine(v.position, occurrence.worldTransform),
        );
      const worldBox = merged(
        [...points.values()].map((point) => ({
          box: { min: point, max: point },
        })),
      );
      const tolerance = distanceTolerance(
        points.size ? length(subtract(worldBox.max, worldBox.min)) : 0,
        project.geometryPolicy,
      );
      const source = (
        kind: Source["kind"],
        entityId: string,
        points: Vec3[],
        holes?: Vec3[][],
        normal?: Vec3,
      ) => {
        if (sources.length >= 500000)
          throw Error(
            "Сцена превышает бюджет индекса привязок: 500000 сущностей.",
          );
        const ref: EntityRef = {
          definitionId: did,
          geometryId: gid,
          kind,
          entityId,
          occurrencePath: [...occurrence.path],
        };
        sources.push({
          key: JSON.stringify([occurrence.path, kind, entityId]),
          kind,
          points,
          holes,
          normal,
          ref,
          locked: occurrence.locked,
          degree: degree.get(entityId),
          box: boxOf(points),
          tolerance,
        });
      };
      for (const [vid, point] of points) source("vertex", vid, [point]);
      for (const e of Object.values(g.edges))
        source("edge", e.id, [points.get(e.start)!, points.get(e.end)!]);
      const loop = (lid: string) =>
        g.loops[lid].coedgeIds.map((cid) => {
          const c = g.coedges[cid],
            e = g.edges[c.edgeId];
          return points.get(c.direction === 1 ? e.start : e.end)!;
        });
      for (const f of Object.values(g.faces))
        source(
          "face",
          f.id,
          loop(f.outerLoopId),
          f.innerLoopIds.map(loop),
          affinePlane(f.plane, occurrence.worldTransform).normal,
        );
    }
    this.sourceCount = sources.length;
    this.root = build(sources);
    this.tolerance = distanceTolerance(
      this.root ? length(subtract(this.root.box.max, this.root.box.min)) : 0,
      project.geometryPolicy,
    );
  }
  reset() {
    this.previous = null;
    this.acquired = [];
  }
  query(q: SnapQuery): {
    candidate: SnapCandidate | null;
    raw: Vec3 | null;
    candidates: SnapCandidate[];
  } {
    assertVector(q.anchor);
    assertVector(q.ray.origin);
    assertVector(q.ray.direction);
    validatePlane(q.plane);
    if (
      q.cursor.length !== 2 ||
      !q.cursor.every(Number.isFinite) ||
      q.axes.length !== 3 ||
      !Number.isFinite(q.gridStep) ||
      q.gridStep < 0 ||
      length(q.ray.direction) < 1e-15 ||
      (q.axis !== undefined && q.axis !== null && ![0, 1, 2].includes(q.axis))
    )
      throw Error("Неверные параметры поиска привязок.");
    q.axes.forEach((a) => {
      assertVector(a);
      normalize(a);
    });
    const radius = q.radius ?? 10,
      release = q.releaseRadius ?? 16;
    if (!(radius > 0 && release >= radius && Number.isFinite(release)))
      throw Error("Неверный радиус привязки.");
    const raw = rayOnPlane(q.ray.origin, q.ray.direction, q.plane);
    this.stats = {
      visited: 0,
      inspected: 0,
      tested: 0,
      pairs: 0,
      truncated: false,
    };
    const candidates: SnapCandidate[] = [],
      edges: Source[] = [],
      occluders: Source[] = [];
    const append = (
      kind: SnapKind,
      point: Vec3,
      key: string,
      ref?: EntityRef,
      guide?: [Vec3, Vec3],
    ) => {
      if (point.some((n) => !Number.isFinite(n) || Math.abs(n) > 1e9)) return;
      const p = q.project(point),
        distance = Math.hypot(p.x - q.cursor[0], p.y - q.cursor[1]);
      if (!p.visible || !Number.isFinite(distance) || distance > release)
        return;
      candidates.push({
        kind,
        point: [...point],
        key,
        ref: ref
          ? { ...ref, occurrencePath: [...ref.occurrencePath] }
          : undefined,
        distance,
        depth: p.depth,
        label:
          kind === "axis"
            ? `Ось ${["X", "Y", "Z"][Number(key.split("/").at(-1))]}`
            : labels[kind],
        guide: guide ? [[...guide[0]], [...guide[1]]] : undefined,
      });
    };
    if (q.enabled && this.root) {
      const visit = (branch: Branch) => {
        if (this.stats.inspected >= 10000) {
          this.stats.truncated = true;
          return;
        }
        this.stats.visited++;
        if (!nearby(branch.box, q, release)) return;
        if (!branch.items) {
          visit(branch.left!);
          visit(branch.right!);
          return;
        }
        for (const s of branch.items) {
          if (this.stats.inspected >= 10000) {
            this.stats.truncated = true;
            break;
          }
          this.stats.inspected++;
          if (s.kind === "face" && nearby(s.box, q, release)) occluders.push(s);
          if (
            (s.locked && !q.includeLocked) ||
            (q.contextOnly &&
              !samePath(s.ref.occurrencePath, q.contextPath ?? []))
          )
            continue;
          if (!nearby(s.box, q, release)) continue;
          this.stats.tested++;
          if (s.kind === "vertex") {
            append(
              s.degree === 1 ? "endpoint" : "vertex",
              s.points[0],
              s.key,
              s.ref,
            );
            if ((s.degree ?? 0) >= 3)
              append("intersection", s.points[0], s.key + "/junction", s.ref);
          } else if (s.kind === "edge") {
            edges.push(s);
            const [a, b] = s.points,
              p = edgePoint(a, b, q);
            append(
              "midpoint",
              multiply(add(a, b), 0.5),
              s.key + "/midpoint",
              s.ref,
            );
            if (p) append("edge", p, s.key, s.ref);
          } else {
            const n = s.normal!;
            const p = rayOnPlane(q.ray.origin, q.ray.direction, {
              origin: s.points[0],
              u: [1, 0, 0],
              v: [0, 1, 0],
              normal: n,
            });
            if (
              p &&
              inside(p, s.points, n) &&
              !s.holes?.some((h) => inside(p, h, n))
            )
              append("face", p, s.key, s.ref);
          }
        }
      };
      visit(this.root);
      // Bounded local pair search. Never intersect different editing occurrences.
      edges.sort((a, b) => {
        const pa = edgePoint(a.points[0], a.points[1], q)!,
          pb = edgePoint(b.points[0], b.points[1], q)!;
        const a1 = pa ? q.project(pa) : { x: Infinity, y: Infinity },
          b1 = pb ? q.project(pb) : { x: Infinity, y: Infinity };
        return (
          Math.hypot(a1.x - q.cursor[0], a1.y - q.cursor[1]) -
            Math.hypot(b1.x - q.cursor[0], b1.y - q.cursor[1]) ||
          a.key.localeCompare(b.key)
        );
      });
      if (edges.length > 64) this.stats.truncated = true;
      const local = edges.slice(0, 64);
      for (let i = 0; i < local.length; i++)
        for (let j = i + 1; j < local.length; j++) {
          const a = local[i],
            b = local[j];
          if (
            !samePath(a.ref.occurrencePath, b.ref.occurrencePath) ||
            a.ref.geometryId !== b.ref.geometryId
          )
            continue;
          this.stats.pairs++;
          for (const hit of segmentIntersections(
            a.points[0],
            a.points[1],
            b.points[0],
            b.points[1],
            Math.max(a.tolerance, b.tolerance),
          ))
            append(
              "intersection",
              hit.point,
              a.key + "/intersection/" + b.key,
              a.ref,
            );
        }
      this.acquired = [
        ...new Map(
          [...local, ...this.acquired].map((e) => [e.key, e]),
        ).values(),
      ].slice(0, 32);
      if (raw)
        for (const s of this.acquired.filter(
          (s) =>
            (!s.locked || q.includeLocked) &&
            (!q.contextOnly ||
              samePath(s.ref.occurrencePath, q.contextPath ?? [])),
        )) {
          const direction = normalize(subtract(s.points[1], s.points[0]));
          const parallel = add(
            q.anchor,
            multiply(direction, dot(subtract(raw, q.anchor), direction)),
          );
          append("parallel", parallel, s.key + "/parallel", s.ref, [
            q.anchor,
            parallel,
          ]);
          const perp = cross(q.plane.normal, direction);
          if (length(perp) > 1e-10) {
            const d = normalize(perp),
              p = add(q.anchor, multiply(d, dot(subtract(raw, q.anchor), d)));
            append("perpendicular", p, s.key + "/perpendicular", s.ref, [
              q.anchor,
              p,
            ]);
          }
        }
    }
    if (raw) {
      if (q.enabled) append("origin", q.plane.origin, "plane/origin");
      for (const [i, axis] of q.axes.entries()) {
        const d = normalize(axis),
          p = add(q.anchor, multiply(d, dot(subtract(raw, q.anchor), d)));
        if (q.axis === i || q.enabled)
          append("axis", p, "axis/" + i, undefined, [q.anchor, p]);
      }
      if (q.enabled && q.gridStep > 0 && Number.isFinite(q.gridStep)) {
        const d = subtract(raw, q.plane.origin),
          u = Math.round(dot(d, q.plane.u) / q.gridStep) * q.gridStep,
          v = Math.round(dot(d, q.plane.v) / q.gridStep) * q.gridStep;
        append(
          "grid",
          add(
            q.plane.origin,
            add(multiply(q.plane.u, u), multiply(q.plane.v, v)),
          ),
          "grid",
        );
      }
    }
    let eligible = candidates;
    if (q.axis !== undefined && q.axis !== null) {
      const axis = normalize(q.axes[q.axis]);
      eligible = eligible.filter((c) => {
        const d = subtract(c.point, q.anchor);
        return (
          length(subtract(d, multiply(axis, dot(d, axis)))) <=
          distanceTolerance(length(d), this.policy)
        );
      });
    }
    let occlusionChecks = 0;
    eligible = eligible.filter((c) => {
      if (!c.ref || c.kind === "parallel" || c.kind === "perpendicular")
        return true;
      const direction = q.perspective
        ? normalize(subtract(q.ray.origin, c.point))
        : multiply(q.ray.direction, -1);
      for (const face of occluders) {
        if (++occlusionChecks > 20000) {
          this.stats.truncated = true;
          return false;
        }
        const normal = face.normal!,
          denom = dot(direction, normal);
        if (Math.abs(denom) < 1e-12) continue;
        const t = dot(subtract(face.points[0], c.point), normal) / denom;
        if (
          t <= face.tolerance ||
          (q.perspective && t >= length(subtract(q.ray.origin, c.point)))
        )
          continue;
        const hit = add(c.point, multiply(direction, t));
        if (
          inside(hit, face.points, normal) &&
          !face.holes?.some((h) => inside(hit, h, normal))
        )
          return false;
      }
      return true;
    });
    const rank = (c: SnapCandidate) =>
      c.kind === "grid" &&
      q.axes.some((axis) => {
        const d = subtract(c.point, q.anchor),
          a = normalize(axis);
        return (
          length(subtract(d, multiply(a, dot(d, a)))) <=
          distanceTolerance(length(d), this.policy)
        );
      })
        ? 2.5
        : priority[c.kind];
    eligible.sort(
      (a, b) =>
        rank(a) - rank(b) ||
        a.distance - b.distance ||
        a.depth - b.depth ||
        a.key.localeCompare(b.key),
    );
    let result = eligible.find((c) => c.distance <= radius) ?? null;
    const held =
      this.previous && eligible.find((c) => c.key === this.previous!.key);
    if (
      held &&
      (!result || rank(result) >= rank(held) || result.distance > radius * 0.4)
    )
      result = held;
    this.previous = result;
    if (q.axis !== undefined && q.axis !== null && raw) {
      const d = normalize(q.axes[q.axis]),
        point = add(q.anchor, multiply(d, dot(subtract(raw, q.anchor), d)));
      if (!result) {
        const p = q.project(point);
        if (
          p.visible &&
          point.every((n) => Number.isFinite(n) && Math.abs(n) <= 1e9)
        )
          result = {
            key: "axis/" + q.axis,
            kind: "axis",
            point,
            distance: Math.hypot(p.x - q.cursor[0], p.y - q.cursor[1]),
            depth: p.depth,
            label: `Ось ${["X", "Y", "Z"][q.axis]}`,
            guide: [q.anchor, point],
          };
      }
    }
    if (this.stats.truncated) {
      this.previous = null;
      return { candidate: null, raw: null, candidates: eligible };
    }
    return { candidate: result, raw, candidates: eligible };
  }
}
