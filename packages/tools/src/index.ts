import type { TransformMode } from "@forma/shared";
import type { SketchTool } from "./controller";
export * from "./controller";
export type ToolName =
  | TransformMode
  | "select"
  | "line"
  | "rectangle"
  | "circle"
  | "polygon"
  | "freehand"
  | "erase"
  | "arc"
  | "extrude"
  | "offset"
  | "orbit"
  | "pan";
export function isSketchTool(tool: ToolName): tool is SketchTool {
  return (
    tool === "line" ||
    tool === "rectangle" ||
    tool === "circle" ||
    tool === "polygon" ||
    tool === "arc"
  );
}
export const shortcuts: Record<string, ToolName> = {
  v: "select",
  e: "erase",
  m: "translate",
  q: "rotate",
  o: "orbit",
  h: "pan",
  r: "rectangle",
  c: "circle",
  a: "arc",
  l: "line",
  p: "extrude",
  f: "offset",
  " ": "select",
  s: "scale",
};
export const toolLabels = {
  select: "Выделение",
  translate: "Перемещение",
  rotate: "Вращение",
  scale: "Масштаб",
  line: "Линия",
  rectangle: "Прямоугольник",
  circle: "Окружность",
  polygon: "Многоугольник",
  freehand: "Свободное рисование",
  erase: "Ластик",
  arc: "Дуга",
  extrude: "Вытянуть / вдавить",
  offset: "Отступ",
  orbit: "Орбита",
  pan: "Панорама",
} as const;

export * from "./freehand";
