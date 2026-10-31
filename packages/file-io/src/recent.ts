export interface RecentProject {
  id: string;
  name: string;
  fileName: string;
  source: "browser" | "native";
  lastOpened: number;
  available: boolean;
  path?: string;
}
export const RECENT_PROJECTS_KEY = "vextrio.recent-projects.v1";
export interface RecentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
const valid = (v: unknown): v is RecentProject => {
  if (!v || typeof v !== "object") return false;
  const r = v as RecentProject;
  return (
    typeof r.id === "string" &&
    r.id.length > 0 &&
    r.id.length <= 600 &&
    typeof r.name === "string" &&
    r.name.length > 0 &&
    r.name.length <= 200 &&
    typeof r.fileName === "string" &&
    r.fileName.length <= 255 &&
    r.source === "browser" &&
    Number.isSafeInteger(r.lastOpened) &&
    r.lastOpened >= 0
  );
};
/** Metadata only: a browser filename is not a filesystem permission or a backup. */
export function createRecentProjectStore(storage: RecentStorage) {
  const list = (): RecentProject[] => {
    const text = storage.getItem(RECENT_PROJECTS_KEY);
    if (text === null) return [];
    if (text.length > 64000) throw Error("Список недавних проектов повреждён.");
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw Error("Список недавних проектов повреждён.");
    }
    if (
      !Array.isArray(data) ||
      data.length > 16 ||
      !data.every(valid) ||
      new Set(data.map((r) => r.id)).size !== data.length
    )
      throw Error("Список недавних проектов повреждён.");
    return data.map((r) => ({
      id: r.id,
      name: r.name,
      fileName: r.fileName,
      source: "browser",
      lastOpened: r.lastOpened,
      available: false,
    }));
  };
  return {
    list,
    record(
      name: string,
      file: Pick<File, "name" | "size" | "lastModified">,
      now = Date.now(),
    ) {
      const entry: RecentProject = {
        id: JSON.stringify([file.name, file.size, file.lastModified]),
        name: name.trim().slice(0, 200) || file.name.slice(0, 200) || "Проект",
        fileName: file.name.slice(0, 255),
        source: "browser",
        lastOpened: now,
        available: false,
      };
      if (!valid(entry)) throw Error("Некорректная запись недавнего проекта.");
      const entries = [entry, ...list().filter((r) => r.id !== entry.id)].slice(
        0,
        16,
      );
      storage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(entries));
      return entries;
    },
    remove(id: string) {
      const next = list().filter((r) => r.id !== id);
      storage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(next));
      return next;
    },
    clear() {
      storage.removeItem(RECENT_PROJECTS_KEY);
    },
  };
}
