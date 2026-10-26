import type { TransformMode } from "@forma/shared";
export * from "./controller";
export type ToolName =
  TransformMode | "select" | "line" | "rectangle" | "extrude";
export const shortcuts: Record<string, ToolName> = {
  v: "select",
  g: "translate",
  r: "rectangle",
  e: "rotate",
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
} as const;
