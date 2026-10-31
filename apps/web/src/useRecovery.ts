import { useEffect, useMemo, useRef, useState } from "react";
import {
  createRecoveryStore,
  RecoveryWriter,
  type RecoverySnapshot,
  resetNativeDestination,
} from "@forma/file-io";
import { useEditor, isDirty } from "@forma/editor";
export function useRecovery() {
  const store = useMemo(() => createRecoveryStore(), []),
    writer = useRef<RecoveryWriter | null>(null),
    [snapshot, setSnapshot] = useState<RecoverySnapshot | null>(null),
    [error, setError] = useState(""),
    [savedAt, setSavedAt] = useState(0),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let mounted = true;
    const w = new RecoveryWriter(
      store,
      (s) => {
        if (mounted) {
          setSavedAt(s.savedAt);
          setSnapshot(s);
          setError("");
        }
      },
      (e) => {
        if (mounted)
          setError(e instanceof Error ? e.message : "Автокопия недоступна.");
      },
    );
    writer.current = w;
    void store
      .load()
      .then((s) => {
        if (mounted) setSnapshot(s);
      })
      .catch((e) => {
        if (mounted) setError(e.message);
      });
    const stop = useEditor.subscribe((s, b) => {
      if (s.revision === b.revision && s.savedSignature === b.savedSignature)
        return;
      if (isDirty()) w.schedule(s.project);
      else w.cancel();
    });
    return () => {
      mounted = false;
      stop();
      w.cancel();
      writer.current = null;
    };
  }, [store]);
  const discard = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await writer.current?.discard();
      setSnapshot(null);
      setError("");
      setSavedAt(0);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Не удалось удалить автокопию.",
      );
    } finally {
      setBusy(false);
    }
  };
  const restore = async () => {
    if (!snapshot || busy) return false;
    setBusy(true);
    try {
      await resetNativeDestination();
      const r = useEditor.getState().replace(snapshot.project);
      if (r.status === "rejected") throw Error(r.error);
      useEditor.setState({
        savedSignature: "",
        message: "Проект восстановлен из автокопии. Сохраните файл .v3d.",
      });
      return true;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Не удалось восстановить проект.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { snapshot, error, savedAt, busy, discard, restore };
}
