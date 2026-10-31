import type { TransformMode } from "@forma/shared";
import type { SketchTool } from "./controller";
export * from "./controller";
export type ToolName =
  | TransformMode
  | "select"
  | "line"
  | "rectangle"
  | "circle"
  | "arc"
  | "extrude"
  | "orbit"
  | "pan";
export function isSketchTool(tool: ToolName): tool is SketchTool {
  return (
    tool === "line" ||
    tool === "rectangle" ||
    tool === "circle" ||
    tool === "arc"
  );
}
export const shortcuts: Record<string, ToolName> = {
  v: "select",
  m: "translate",
  q: "rotate",
  o: "orbit",
  h: "pan",
  r: "rectangle",
  c: "circle",
  a: "arc",
  l: "line",
  p: "extrude",
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
  arc: "Дуга",
  extrude: "Вытянуть / вдавить",
  orbit: "Орбита",
  pan: "Панорама",
} as const;
