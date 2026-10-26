import {
  parseProject,
  serializeProject,
  validateProject,
  MAX_PROJECT_BYTES,
} from "@forma/document";
import { clone } from "@forma/shared";
export * from "./export";
export * from "./recovery";
import type { Document as Project } from "@forma/document";
export type SaveResult =
  | { status: "saved" }
  | { status: "download-started" }
  | { status: "cancelled" };
export interface FileAdapter {
  open(file: File): Promise<Project>;
  save(project: Project): Promise<SaveResult>;
}
export interface BrowserDownload {
  (text: string, name: string): void;
}
function download(text: string, name: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  try {
    anchor.href = url;
    anchor.download = name;
    document.body.append(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}
const safeName = (name: string) =>
  name.replace(/[<>:"/\\|?*]/g, "_") || "Проект";
export function createBrowserFileAdapter(
  startDownload: BrowserDownload = download,
): FileAdapter {
  return {
    async open(file) {
      if (file.size > MAX_PROJECT_BYTES)
        throw Error("Файл превышает допустимые 20 МБ.");
      return parseProject(await file.text());
    },
    async save(project) {
      const text = serializeProject(project);
      startDownload(text, `${safeName(project.name)}.v3d`);
      return { status: "download-started" };
    },
  };
}
export const browserFileAdapter = createBrowserFileAdapter();
export const isDesktop = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export interface NativeOpenCandidate {
  readonly project: Project;
}
export interface NativeTransport {
  openCandidate(): Promise<{ candidateToken: string; text: string } | null>;
  acceptCandidate(candidateToken: string): Promise<void>;
  rejectCandidate(candidateToken: string): Promise<void>;
  save(text: string, name: string, saveAs: boolean): Promise<boolean>;
  resetDestination(): Promise<void>;
}
export function createNativeFileAdapter(transport: NativeTransport) {
  const pending = new WeakMap<
    NativeOpenCandidate,
    { token: string; project: Project }
  >();
  return {
    async open(): Promise<NativeOpenCandidate | null> {
      const response = await transport.openCandidate();
      if (response === null) return null;
      try {
        const project = parseProject(response.text);
        const candidate = { project: clone(project) };
        pending.set(candidate, { token: response.candidateToken, project });
        return candidate;
      } catch (error) {
        await transport
          .rejectCandidate(response.candidateToken)
          .catch(() => {});
        throw error;
      }
    },
    async reject(candidate: NativeOpenCandidate) {
      const entry = pending.get(candidate);
      if (entry) {
        await transport.rejectCandidate(entry.token);
        pending.delete(candidate);
      }
    },
    async accept(candidate: NativeOpenCandidate): Promise<Project> {
      const entry = pending.get(candidate);
      if (!entry) throw Error("Файл уже принят, отменён или устарел.");
      try {
        validateProject(candidate.project);
        if (JSON.stringify(candidate.project) !== JSON.stringify(entry.project))
          throw Error("Кандидат открытия был изменён.");
      } catch (error) {
        await transport.rejectCandidate(entry.token).catch(() => {});
        pending.delete(candidate);
        throw error;
      }
      // Commit the destination only after parsing, validation and explicit UI acceptance.
      await transport.acceptCandidate(entry.token);
      pending.delete(candidate);
      return clone(entry.project);
    },
    async save(project: Project, saveAs = false): Promise<SaveResult> {
      const text = serializeProject(project);
      return {
        status: (await transport.save(text, safeName(project.name), saveAs))
          ? "saved"
          : "cancelled",
      };
    },
    async resetDestination() {
      await transport.resetDestination();
    },
  };
}
async function invoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return (await import("@tauri-apps/api/core")).invoke<T>(command, args);
}
const native = createNativeFileAdapter({
  openCandidate: () => invoke("open_project"),
  acceptCandidate: (candidateToken) =>
    invoke("accept_open", { candidateToken }),
  rejectCandidate: (candidateToken) =>
    invoke("reject_open", { candidateToken }),
  save: (text, name, saveAs) => invoke("save_project", { text, name, saveAs }),
  resetDestination: () => invoke("reset_destination"),
});
export const openNative = () => native.open();
export const acceptNativeOpen = (candidate: NativeOpenCandidate) =>
  native.accept(candidate);
export const rejectNativeOpen = (candidate: NativeOpenCandidate) =>
  native.reject(candidate);
export const saveNative = (project: Project, saveAs: boolean) =>
  native.save(project, saveAs);
export async function resetNativeDestination() {
  if (isDesktop()) await native.resetDestination();
}
