import {
  emptyProjectV2,
  validateProject,
  type Document,
} from "@forma/document";
export type TemplateId = "empty" | "architecture" | "furniture" | "printing";
export interface NewProjectOptions {
  name: string;
  units: "m" | "cm" | "mm";
  template: TemplateId;
}
export const templates = [
  {
    id: "empty",
    name: "Пустой проект",
    description: "Чистая сцена для любой идеи.",
    units: "m",
    gridStep: 0.25,
    camera: [9, 7, 10],
    badge: "С чистого листа",
  },
  {
    id: "architecture",
    name: "Архитектура",
    description: "Метры и сетка 100 мм для планировки и объёмов.",
    units: "m",
    gridStep: 0.1,
    camera: [12, 9, 14],
    badge: "Пространства",
  },
  {
    id: "furniture",
    name: "Мебель",
    description: "Миллиметры и сетка 10 мм для деталей и сборок.",
    units: "mm",
    gridStep: 0.01,
    camera: [3, 2, 3],
    badge: "Предметы",
  },
  {
    id: "printing",
    name: "3D-печать",
    description: "Миллиметры и сетка 1 мм для небольших моделей.",
    units: "mm",
    gridStep: 0.001,
    camera: [0.6, 0.5, 0.7],
    badge: "Детали",
  },
] as const;
export function createHomeProject(options: NewProjectOptions) {
  const template = templates.find((t) => t.id === options.template);
  const name = options.name.trim();
  if (
    !template ||
    !name ||
    name.length > 200 ||
    !["m", "cm", "mm"].includes(options.units)
  )
    throw Error("Введите название проекта и выберите допустимые параметры.");
  const project = emptyProjectV2(name);
  project.units = options.units;
  project.camera.position = [...template.camera];
  project.extensions["vextrio:home"] = {
    templateId: template.id,
    gridStep: template.gridStep,
    planeName: "XZ",
  };
  validateProject(project);
  return project;
}
export function homeProjectSettings(project: Document) {
  const defaults = { gridStep: 0.25, planeName: "XZ" as const };
  if (project.schemaVersion !== 2) return defaults;
  const config = project.extensions["vextrio:home"] as
    | { templateId?: unknown; gridStep?: unknown; planeName?: unknown }
    | undefined;
  if (
    !config ||
    !templates.some((t) => t.id === config.templateId) ||
    typeof config.gridStep !== "number" ||
    !Number.isFinite(config.gridStep) ||
    config.gridStep < 1e-6 ||
    config.gridStep > 1000 ||
    config.planeName !== "XZ"
  )
    return defaults;
  return { gridStep: config.gridStep, planeName: "XZ" as const };
}
