import earcut from "earcut";
import type { AffineTransform } from "./affine";
import {
  GeometryError,
  type GeometryModel,
  type Face,
  type Vec3,
} from "./model";
import { projectPoint, subtract, cross, dot } from "./math";
import { signedArea, inRegion } from "./sketch-common";
export interface FaceTessellation {
  faceId: string;
  vertexIds: string[];
  positions: Vec3[];
  indices: number[];
  area: number;
}
// Physical area of a derived face in an occurrence. Translation is omitted to
// preserve small dimensions at large world coordinates; shear is retained.
export function tessellationArea(
  dto: FaceTessellation,
  m: AffineTransform,
): number {
  const direction = (v: Vec3): Vec3 => [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2],
  ];
  let area = 0;
  for (let i = 0; i < dto.indices.length; i += 3) {
    const [a, b, c] = dto.indices.slice(i, i + 3).map((j) => dto.positions[j]),
      n = cross(direction(subtract(b, a)), direction(subtract(c, a)));
    area += Math.hypot(...n) / 2;
  }
  return area;
}
// Derived data only. Indices never become document edges or entity identifiers.
export function tessellateFace(
  model: GeometryModel,
  face: Face,
): FaceTessellation {
  const rings = [face.outerLoopId, ...face.innerLoopIds].map((lid) =>
    model.loops[lid].coedgeIds.map((cid) => {
      const c = model.coedges[cid],
        e = model.edges[c.edgeId];
      return c.direction === 1 ? e.start : e.end;
    }),
  );
  const vertexIds = rings.flat(),
    positions = vertexIds.map((v) => model.vertices[v].position),
    projected = rings.map((r) =>
      r.map((v) => projectPoint(model.vertices[v].position, face.plane)),
    ),
    holes: number[] = [];
  let count = rings[0].length;
  for (let i = 1; i < rings.length; i++) {
    holes.push(count);
    count += rings[i].length;
  }
  const flat = projected.flat(),
    indices = earcut(flat.flat(), holes, 2),
    area =
      signedArea(projected[0]) +
      projected.slice(1).reduce((n, p) => n + signedArea(p), 0);
  if (!indices.length || indices.length % 3)
    throw new GeometryError("INVALID_TOPOLOGY", "Tessellation failed", [
      face.id,
    ]);
  let covered = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const ids = indices.slice(i, i + 3);
    if (ids.some((n) => !Number.isInteger(n) || n < 0 || n >= positions.length))
      throw new GeometryError("INVALID_TOPOLOGY", "Invalid triangle index");
    const [a, b, c] = ids.map((n) => flat[n]),
      twice = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (!Number.isFinite(twice) || twice === 0)
      throw new GeometryError("DEGENERATE", "Degenerate render triangle", [
        face.id,
      ]);
    covered += Math.abs(twice) / 2;
    const center: [number, number] = [
      (a[0] + b[0] + c[0]) / 3,
      (a[1] + b[1] + c[1]) / 3,
    ];
    if (!inRegion(center, projected[0], projected.slice(1)))
      throw new GeometryError(
        "INVALID_TOPOLOGY",
        "Triangle falls outside its face",
        [face.id],
      );
    const [p, q, r] = ids.map((n) => positions[n]);
    if (dot(cross(subtract(q, p), subtract(r, p)), face.plane.normal) < 0)
      [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  }
  if (Math.abs(covered - area) > Math.max(1e-12, Math.abs(area) * 1e-9))
    throw new GeometryError("INVALID_TOPOLOGY", "Tessellation area mismatch", [
      face.id,
    ]);
  return { faceId: face.id, vertexIds, positions, indices, area };
}
