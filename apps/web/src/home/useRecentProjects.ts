import { useCallback, useState } from "react";
import {
  createRecentProjectStore,
  isDesktop,
  listNativeRecent,
  removeNativeRecent,
  clearNativeRecent,
  type RecentProject,
} from "@forma/file-io";
export function useRecentProjects() {
  const [entries, setEntries] = useState<RecentProject[]>([]),
    [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      setEntries(
        isDesktop()
          ? await listNativeRecent()
          : createRecentProjectStore(window.localStorage).list(),
      );
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Список проектов недоступен.");
    }
  }, []);
  const record = async (name: string, file: File) => {
    try {
      setEntries(
        createRecentProjectStore(window.localStorage).record(name, file),
      );
      setError("");
    } catch {
      setError(
        "Не удалось запомнить файл. Открытый проект доступен в редакторе.",
      );
    }
  };
  const remove = async (id: string) => {
    try {
      if (isDesktop()) await removeNativeRecent(id);
      else createRecentProjectStore(window.localStorage).remove(id);
      await refresh();
    } catch {
      setError("Не удалось удалить запись.");
    }
  };
  const clear = async () => {
    try {
      if (isDesktop()) {
        await clearNativeRecent();
      } else createRecentProjectStore(window.localStorage).clear();
      await refresh();
    } catch {
      setError("Не удалось очистить список.");
    }
  };
  return { entries, error, refresh, record, remove, clear };
}
