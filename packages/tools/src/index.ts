import type { TransformMode } from "@forma/shared";
export const shortcuts: Record<string, TransformMode | "select"> = {
  v: "select",
  g: "translate",
  r: "rotate",
  s: "scale",
};
export const toolLabels = {
  select: "Выделение",
  translate: "Перемещение",
  rotate: "Вращение",
  scale: "Масштаб",
} as const;
