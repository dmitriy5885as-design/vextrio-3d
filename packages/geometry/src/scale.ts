import { GeometryError, type GeometryModel, type Vec3 } from "./model";
import { add, subtract } from "./math";
import { invertDelta } from "./transactions";
import { prepareVertexMove } from "./move";
import type { ValidationContext } from "./validate";

const MIN_SCALE = 1e-6;
const MAX_SCALE = 1e6;

export function scaledPosition(point: Vec3, origin: Vec3, factors: Vec3): Vec3 {
  if (!origin.every(Number.isFinite))
    throw new GeometryError(
      "NUMERICAL_AMBIGUITY",
      "Точка масштабирования должна содержать конечные координаты.",
    );
  if (
    !factors.every(
      (factor) =>
        Number.isFinite(factor) && factor >= MIN_SCALE && factor <= MAX_SCALE,
    )
  )
    throw new GeometryError(
      "NUMERICAL_AMBIGUITY",
      `Масштаб по каждой оси должен быть от ${MIN_SCALE} до ${MAX_SCALE}.`,
    );
  const offset = subtract(point, origin);
  return add(origin, [
    offset[0] * factors[0],
    offset[1] * factors[1],
    offset[2] * factors[2],
  ]);
}

export function prepareVertexScale(
  model: GeometryModel,
  vertexIds: string[],
  origin: Vec3,
  factors: Vec3,
  context: ValidationContext,
) {
  if (
    !Array.isArray(vertexIds) ||
    vertexIds.length < 1 ||
    vertexIds.length > 4096
  )
    throw new GeometryError("RESOURCE_LIMIT", "Выберите от 1 до 4096 вершин.");
  const seen = new Set<string>(),
    positions = vertexIds.map((key) => {
      const vertex = model.vertices[key];
      if (!vertex || seen.has(key))
        throw new GeometryError(
          "INVALID_TOPOLOGY",
          "Неизвестная или повторная вершина.",
          [key],
        );
      seen.add(key);
      return {
        vertexId: vertex.id,
        position: scaledPosition(vertex.position, origin, factors),
      };
    });
  const change = prepareVertexMove(model, positions, context);
  return {
    forward: change.forward,
    inverse: invertDelta(change.forward),
    lineage: change.lineage,
  };
}
