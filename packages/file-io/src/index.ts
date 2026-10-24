import { parseProject, serializeProject } from "@forma/document";
import type { Project } from "@forma/shared";
export interface FileAdapter {
  open(file: File): Promise<Project>;
  save(project: Project): Promise<void>;
}
export const browserFileAdapter: FileAdapter = {
  async open(file) {
    return parseProject(await file.text());
  },
  async save(project) {
    const text = serializeProject(project);
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.name.replace(/[<>:"/\\|?*]/g, "_") || "Проект"}.v3d`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  },
};
export const isDesktop = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export async function openNative(): Promise<Project | null> {
  const { invoke } = await import("@tauri-apps/api/core");
  const text = await invoke<string | null>("open_project");
  return text === null ? null : parseProject(text);
}
export async function saveNative(
  project: Project,
  saveAs: boolean,
): Promise<boolean> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<boolean>("save_project", {
    text: serializeProject(project),
    name: project.name.replace(/[<>:"/\\|?*]/g, "_"),
    saveAs,
  });
}
export async function resetNativeDestination() {
  if (isDesktop()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("reset_destination");
  }
}
