import type { TransformMode } from "@forma/shared";
export * from "./controller";
export type ToolName =
  TransformMode | "select" | "line" | "rectangle" | "extrude" | "orbit" | "pan";
export const shortcuts: Record<string, ToolName> = {
  v: "select",
  m: "translate",
  q: "rotate",
  o: "orbit",
  h: "pan",
  r: "rectangle",
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
  extrude: "Вытянуть / вдавить",
  orbit: "Орбита",
  pan: "Панорама",
} as const;
