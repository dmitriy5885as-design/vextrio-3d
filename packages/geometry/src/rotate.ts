import { GeometryError, type GeometryModel, type Vec3 } from "./model";
import { add, cross, dot, length, multiply, subtract } from "./math";
import { invertDelta } from "./transactions";
import { validateGeometry, type ValidationContext } from "./validate";
import { prepareVertexMove } from "./move";

const unit = (v: Vec3): Vec3 => {
  const n = length(v);
  if (!Number.isFinite(n) || n <= 1e-12)
    throw new GeometryError(
      "DEGENERATE",
      "Ось вращения должна быть ненулевой.",
    );
  return multiply(v, 1 / n);
};
const rotate = (p: Vec3, origin: Vec3, axis: Vec3, angle: number): Vec3 => {
  const v = subtract(p, origin),
    c = Math.cos(angle),
    s = Math.sin(angle);
  return add(
    origin,
    add(
      add(multiply(v, c), multiply(cross(axis, v), s)),
      multiply(axis, dot(axis, v) * (1 - c)),
    ),
  );
};
export function rotatedPosition(
  point: Vec3,
  origin: Vec3,
  axis: Vec3,
  angle: number,
): Vec3 {
  if (!Number.isFinite(angle) || Math.abs(angle) > Math.PI * 200)
    throw new GeometryError(
      "NUMERICAL_AMBIGUITY",
      "Угол вращения должен быть в пределах ±36000°.",
    );
  return rotate(point, origin, unit(axis), angle);
}
export function prepareVertexRotation(
  model: GeometryModel,
  vertexIds: string[],
  origin: Vec3,
  axis: Vec3,
  angle: number,
  context: ValidationContext,
) {
  validateGeometry(model, context);
  if (
    !Array.isArray(vertexIds) ||
    vertexIds.length < 1 ||
    vertexIds.length > 4096
  )
    throw new GeometryError("RESOURCE_LIMIT", "Выберите от 1 до 4096 вершин.");
  const d = unit(axis);
  if (!origin.every(Number.isFinite))
    throw new GeometryError(
      "NUMERICAL_AMBIGUITY",
      "Точка вращения должна быть конечной.",
    );
  if (!Number.isFinite(angle) || Math.abs(angle) > Math.PI * 200)
    throw new GeometryError(
      "NUMERICAL_AMBIGUITY",
      "Угол вращения должен быть в пределах ±36000°.",
    );
  const after = structuredClone(model),
    seen = new Set<string>();
  for (const key of vertexIds) {
    if (seen.has(key) || !after.vertices[key])
      throw new GeometryError(
        "INVALID_TOPOLOGY",
        "Неизвестная или повторная вершина.",
        [key],
      );
    seen.add(key);
    after.vertices[key].position = rotate(
      after.vertices[key].position,
      origin,
      d,
      angle,
    );
  }
  // Recompute affected face frames from the moved boundary.
  for (const face of Object.values(after.faces)) {
    const loop = after.loops[face.outerLoopId];
    const ids = loop.coedgeIds.map((cid) => {
      const co = after.coedges[cid],
        edge = after.edges[co.edgeId];
      return co.direction === 1 ? edge.start : edge.end;
    });
    if (!ids.some((id) => seen.has(id))) continue;
    const points = ids.map((id) => after.vertices[id].position);
    const faceOrigin = points[0];
    let u: Vec3 | undefined, normal: Vec3 | undefined;
    for (let i = 1; i < points.length - 1 && !normal; i++)
      for (let j = i + 1; j < points.length && !normal; j++) {
        const a = subtract(points[i], faceOrigin),
          b = subtract(points[j], faceOrigin),
          n = cross(a, b);
        if (length(n) > 1e-12) {
          u = multiply(a, 1 / length(a));
          normal = multiply(n, 1 / length(n));
        }
      }
    if (!u || !normal)
      throw new GeometryError("DEGENERATE", "Вращение вырождает грань.", [
        face.id,
      ]);
    face.plane = { origin: [...faceOrigin], u, v: cross(normal, u), normal };
  }
  validateGeometry(after, context);
  // Reuse Move's manifold/contact/face-fold checks on the rotated positions.
  const arranged = prepareVertexMove(
    model,
    vertexIds.map((key) => ({
      vertexId: model.vertices[key].id,
      position: after.vertices[key].position,
    })),
    context,
  );
  const forward = arranged.forward;
  return { forward, inverse: invertDelta(forward), lineage: arranged.lineage };
}
