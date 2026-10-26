import type { Vec3 } from "@forma/shared";
import {
  add,
  subtract,
  multiply,
  dot,
  cross,
  length,
  assertVector,
  inverseAffine,
  transformAffine,
  identityMatrix,
  validateAffine,
  validatePlane,
  type AffineTransform,
} from "@forma/geometry";
export type Unit = "m" | "cm" | "mm";
export const unitFactor: Record<Unit, number> = { m: 1, cm: 0.01, mm: 0.001 };
export type CoordinateSystem = "world" | "local" | "plane";
export type PlaneName = "XY" | "XZ" | "YZ";
export interface WorkPlane {
  origin: Vec3;
  u: Vec3;
  v: Vec3;
  normal: Vec3;
}
export const normalize = (v: Vec3): Vec3 => {
  const n = length(v);
  if (!Number.isFinite(n) || n < 1e-15) throw Error("Не задано направление.");
  return multiply(v, 1 / n);
};
export function workPlane(
  name: PlaneName,
  matrix: AffineTransform = identityMatrix(),
): WorkPlane {
  validateAffine(matrix);
  const origin = transformAffine([0, 0, 0], matrix);
  const a: Vec3 = name === "YZ" ? [0, 1, 0] : [1, 0, 0];
  const b: Vec3 = name === "XY" ? [0, 1, 0] : [0, 0, 1];
  const u = normalize(subtract(transformAffine(a, matrix), origin));
  const vb = subtract(transformAffine(b, matrix), origin);
  const v = normalize(subtract(vb, multiply(u, dot(vb, u))));
  return { origin, u, v, normal: normalize(cross(u, v)) };
}
export function frameMatrix(
  system: CoordinateSystem,
  matrix: AffineTransform,
  plane: WorkPlane,
): AffineTransform {
  if (system === "world") return identityMatrix();
  if (system === "local") return matrix;
  return [...plane.u, 0, ...plane.v, 0, ...plane.normal, 0, ...plane.origin, 1];
}
export function parseDimension(
  text: string,
  unit: Unit,
  signed = false,
): number {
  const match =
    /^\s*([+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?)\s*(mm|cm|m|мм|см|м)?\s*$/i.exec(
      text,
    );
  if (!match) throw Error("Введите число и единицу: 2,5 м; 250 см; 2500 мм.");
  const suffix = match[2]?.toLowerCase();
  const selected =
    suffix === "мм"
      ? "mm"
      : suffix === "см"
        ? "cm"
        : suffix === "м"
          ? "m"
          : (suffix ?? unit);
  const value =
    Number(match[1].replace(",", ".")) * unitFactor[selected as Unit];
  const significant = match[1]
    .split(/e/i)[0]
    .replace(/[+\-.,]/g, "")
    .replace(/^0+/, "")
    .replace(/0+$/, "");
  if (significant.length > 17)
    throw Error("Число содержит больше 17 значащих цифр.");
  if (
    !Number.isFinite(value) ||
    Math.abs(value) > 1e9 ||
    (!signed && value <= 0)
  )
    throw Error(
      "Размер должен быть конечным, положительным и не больше 10⁹ м.",
    );
  if (value === 0 && /[1-9]/.test(match[1].split(/e/i)[0]))
    throw Error("Число слишком мало для представления.");
  return value;
}
export function formatDimension(value: number, unit: Unit): string {
  return `${Number((value / unitFactor[unit]).toPrecision(15))} ${unit}`;
}
export interface PrecisionInput {
  text: string;
  mode: "length" | "coordinates" | "rectangle";
  unit: Unit;
  anchor: Vec3;
  direction: Vec3;
  matrix: AffineTransform;
  plane: WorkPlane;
  system: CoordinateSystem;
  relative: boolean;
  axis?: "X" | "Y" | "Z" | null;
}
export interface PrecisionResult {
  point: Vec3;
  rectangle?: { width: number; height: number; corners: Vec3[] };
}
export function resolvePrecision(input: PrecisionInput): PrecisionResult {
  const { anchor, plane, matrix, system, unit } = input;
  assertVector(anchor);
  validateAffine(matrix);
  validatePlane(plane);
  const frame = frameMatrix(system, matrix, plane);
  const basis = (index: number) =>
    normalize(frame.slice(index * 4, index * 4 + 3) as Vec3);
  const axis = input.axis ? basis({ X: 0, Y: 1, Z: 2 }[input.axis]) : null;
  let point: Vec3, rectangle: PrecisionResult["rectangle"];
  if (input.mode === "length") {
    const distance = parseDimension(input.text, unit);
    let direction = axis ?? normalize(input.direction);
    if (axis && dot(axis, input.direction) < 0) direction = multiply(axis, -1);
    point = add(anchor, multiply(direction, distance));
  } else if (input.mode === "coordinates") {
    let text = input.text.trim(),
      relative = input.relative;
    if (text.startsWith("@")) {
      relative = true;
      text = text.slice(1);
    } else if (text.startsWith("=")) {
      relative = false;
      text = text.slice(1);
    }
    const parts = text.split(";");
    if (parts.length !== 3)
      throw Error("Координаты разделяются точкой с запятой: X; Y; Z.");
    const coords = parts.map((p) => parseDimension(p, unit, true)) as Vec3;
    const start = relative
      ? transformAffine(anchor, inverseAffine(frame))
      : ([0, 0, 0] as Vec3);
    if (relative && coords.some((n, i) => n !== 0 && start[i] + n === start[i]))
      throw Error("Изменение меньше численной точности в этих координатах.");
    point = transformAffine(add(start, coords), frame);
  } else {
    const parts = input.text.split(";");
    if (parts.length !== 2)
      throw Error("Введите ширину; высоту прямоугольника.");
    const [width, height] = parts.map((p) => parseDimension(p, unit));
    const u = multiply(plane.u, width),
      v = multiply(plane.v, height);
    point = add(add(anchor, u), v);
    rectangle = {
      width,
      height,
      corners: [anchor, add(anchor, u), point, add(anchor, v), anchor],
    };
    if (axis)
      throw Error("Размеры прямоугольника несовместимы с фиксацией одной оси.");
  }
  assertVector(point);
  rectangle?.corners.forEach(assertVector);
  if (input.mode === "length" && point.every((n, i) => n === anchor[i]))
    throw Error("Длина меньше численной точности в этих координатах.");
  if (axis) {
    const delta = subtract(point, anchor),
      off = subtract(delta, multiply(axis, dot(delta, axis)));
    if (length(off) > Math.max(1e-7, length(delta) * 1e-12))
      throw Error("Координаты противоречат зафиксированной оси.");
  }
  return { point, rectangle };
}
export function rayOnPlane(
  origin: Vec3,
  direction: Vec3,
  plane: WorkPlane,
): Vec3 | null {
  const denom = dot(direction, plane.normal);
  if (Math.abs(denom) < 1e-12) return null;
  const t = dot(subtract(plane.origin, origin), plane.normal) / denom;
  if (t < 0) return null;
  const point = add(origin, multiply(direction, t));
  return point.every((n) => Number.isFinite(n) && Math.abs(n) <= 1e9)
    ? point
    : null;
}
