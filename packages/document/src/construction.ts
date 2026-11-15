import type { Vec3 } from "@forma/shared";
import {
  assertVector,
  length,
  subtract,
  cross,
  dot,
  multiply,
} from "@forma/geometry";
import { definitionOccurrences, type ProjectV2 } from "./v2";

export const constructionKey = "vextrio:construction";
export interface ConstructionGuide {
  id: string;
  definitionId: string;
  kind: "point" | "line";
  origin: Vec3;
  direction?: Vec3;
}
export interface ConstructionData {
  version: 1;
  guides: Record<string, ConstructionGuide>;
}
export function constructionData(project: ProjectV2): ConstructionData {
  return (
    (project.extensions[constructionKey] as ConstructionData | undefined) ?? {
      version: 1,
      guides: {},
    }
  );
}
// Known extensions are validated; unknown vendor extensions remain untouched.
export function validateConstruction(
  project: ProjectV2,
  reserved: Set<string>,
) {
  const data = project.extensions[constructionKey] as
    ConstructionData | undefined;
  if (data === undefined) return;
  if (
    !data ||
    data.version !== 1 ||
    !data.guides ||
    typeof data.guides !== "object" ||
    Array.isArray(data.guides)
  )
    throw Error("Некорректные направляющие проекта.");
  if (Object.keys(data.guides).length > 256)
    throw Error("Превышен лимит направляющих (256).");
  let expanded = 0;
  const counts = new Map<string, number>();
  for (const guide of Object.values(data.guides)) {
    if (guide && typeof guide.definitionId === "string")
      counts.set(guide.definitionId, (counts.get(guide.definitionId) ?? 0) + 1);
  }
  for (const occurrence of definitionOccurrences(project)) {
    if (occurrence.visible)
      expanded += counts.get(occurrence.definitionId) ?? 0;
    if (expanded > 4096)
      throw Error("Превышен бюджет экземпляров направляющих (4096).");
  }
  for (const [key, guide] of Object.entries(data.guides)) {
    if (
      !guide ||
      !key ||
      guide.id !== key ||
      reserved.has(key) ||
      !Object.hasOwn(project.definitions, guide.definitionId) ||
      !["point", "line"].includes(guide.kind)
    )
      throw Error("Некорректный ID или контекст направляющей.");
    assertVector(guide.origin);
    if (guide.kind === "line") {
      assertVector(guide.direction!);
      if (Math.abs(length(guide.direction!) - 1) > 1e-9)
        throw Error("Направление должно быть единичным.");
    } else if (guide.direction !== undefined) {
      throw Error("Точка не имеет направления.");
    }
    reserved.add(key);
  }
}
export function measurement(a: Vec3, b: Vec3, c?: Vec3) {
  assertVector(a);
  assertVector(b);
  const first = subtract(b, a),
    distance = length(first);
  if (distance <= 1e-9) throw Error("Выберите разные точки.");
  const direction = multiply(first, 1 / distance);
  if (!c) return { distance, direction };
  assertVector(c);
  const second = subtract(c, a),
    magnitude = length(second);
  if (magnitude <= 1e-9) throw Error("Выберите разные точки.");
  const other = multiply(second, 1 / magnitude);
  // atan2 retains precision close to zero and 180 degrees.
  const angle = Math.atan2(
    length(cross(direction, other)),
    dot(direction, other),
  );
  return { distance, direction, angle };
}
