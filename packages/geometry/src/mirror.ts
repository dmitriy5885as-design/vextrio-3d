import {
  GeometryError,
  id,
  type GeometryModel,
  type Id,
  type Vec3,
} from "./model";
import { dot, length, multiply, subtract } from "./math";
import { invertDelta } from "./transactions";
import { prepareVertexMove } from "./move";
import type { ValidationContext } from "./validate";
import { validateGeometry } from "./validate";

export function mirroredPosition(
  point: Vec3,
  origin: Vec3,
  normal: Vec3,
): Vec3 {
  if (!point.every(Number.isFinite) || !origin.every(Number.isFinite))
    throw new GeometryError(
      "NUMERICAL_AMBIGUITY",
      "Точки отражения должны содержать конечные координаты.",
    );
  if (!normal.every(Number.isFinite))
    throw new GeometryError(
      "NUMERICAL_AMBIGUITY",
      "Нормаль плоскости отражения должна быть конечной.",
    );
  const size = length(normal);
  if (!Number.isFinite(size) || size <= 1e-12)
    throw new GeometryError("DEGENERATE", "Плоскость отражения не задана.");
  const unit = multiply(normal, 1 / size),
    distance = dot(subtract(point, origin), unit);
  return subtract(point, multiply(unit, 2 * distance));
}

export function prepareVertexMirror(
  model: GeometryModel,
  vertexIds: string[],
  origin: Vec3,
  normal: Vec3,
  context: ValidationContext,
  operationId: Id<"operation"> = id("direct-vertex-mirror"),
) {
  validateGeometry(model, context);
  if (
    !Array.isArray(vertexIds) ||
    vertexIds.length < 1 ||
    vertexIds.length > 4096
  )
    throw new GeometryError("RESOURCE_LIMIT", "Выберите от 1 до 4096 вершин.");
  const selected = new Set<string>();
  for (const vertexId of vertexIds) {
    if (!model.vertices[vertexId] || selected.has(vertexId))
      throw new GeometryError(
        "INVALID_TOPOLOGY",
        "Неизвестная или повторная вершина.",
        [vertexId],
      );
    selected.add(vertexId);
  }
  const facesToReverse = new Set<string>();
  for (const face of Object.values(model.faces)) {
    const boundary = [face.outerLoopId, ...face.innerLoopIds].flatMap(
      (loopId) =>
        model.loops[loopId].coedgeIds.flatMap((coedgeId) => {
          const coedge = model.coedges[coedgeId],
            edge = model.edges[coedge.edgeId];
          return [edge.start, edge.end];
        }),
    );
    const selectedCount = new Set(
      boundary.filter((vertexId) => selected.has(vertexId)),
    ).size;
    if (selectedCount > 0 && selectedCount !== new Set(boundary).size)
      throw new GeometryError(
        "UNSUPPORTED_OPERATION",
        "Отражайте грань целиком: выберите все её граничные вершины.",
        [face.id],
      );
    if (selectedCount > 0) facesToReverse.add(face.id);
  }
  const positions = [...selected].map((vertexId) => ({
    vertexId: model.vertices[vertexId].id,
    position: mirroredPosition(
      model.vertices[vertexId].position,
      origin,
      normal,
    ),
  }));
  const change = prepareVertexMove(
    model,
    positions,
    context,
    operationId,
    facesToReverse,
  );
  return {
    forward: change.forward,
    inverse: invertDelta(change.forward),
    lineage: change.lineage,
  };
}
