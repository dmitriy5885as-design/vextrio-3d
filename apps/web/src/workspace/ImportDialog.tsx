import { useEffect, useRef, useState } from "react";
import { parseOBJ, parseSTL, type ImportedPart } from "@forma/file-io";
import { useEditor, awaitGeometryCommits } from "@forma/editor";
export function ImportDialog({
  file,
  onClose,
  onImported,
}: {
  file: File;
  onClose: () => void;
  onImported: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    worker = useRef<Worker | null>(null),
    cancelled = useRef(false),
    abort = useRef<(() => void) | null>(null);
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "",
    brep = ["brep", "brp"].includes(ext),
    cad = ["step", "stp", "iges", "igs", "brep", "brp"].includes(ext);
  const [unit, setUnit] = useState(
      ext === "stl" ? "mm" : useEditor.getState().project.units,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    cancelled.current = false;
    const last = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      cancelled.current = true;
      abort.current?.();
      worker.current?.terminate();
      last?.focus();
    };
  }, []);
  const close = () => {
    cancelled.current = true;
    abort.current?.();
    worker.current?.terminate();
    onClose();
  };
  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    const started = useEditor.getState().project;
    try {
      if (file.size > 20_000_000)
        throw Error("Максимальный размер файла — 20 МБ.");
      const buffer = await file.arrayBuffer();
      if (cancelled.current) return;
      let parts: ImportedPart[];
      if (cad)
        parts = await new Promise<ImportedPart[]>((resolve, reject) => {
          const task = new Worker(`${import.meta.env.BASE_URL}cad-worker.js`);
          worker.current = task;
          const timeout = setTimeout(() => {
            task.terminate();
            reject(
              Error(
                "CAD-импорт превысил 60 секунд. Попробуйте упрощённую модель.",
              ),
            );
          }, 60000);
          const finish = () => {
            clearTimeout(timeout);
            task.terminate();
            worker.current = null;
            abort.current = null;
          };
          abort.current = () => {
            finish();
            reject(new DOMException("Импорт отменён", "AbortError"));
          };
          task.onmessage = ({ data }) => {
            finish();
            if (data.error) reject(Error(data.error));
            else
              resolve(
                brep
                  ? data.parts.map((part: ImportedPart) => ({
                      ...part,
                      positions: part.positions.map((p) =>
                        p.map(
                          (n) =>
                            n *
                            (unit === "mm" ? 0.001 : unit === "cm" ? 0.01 : 1),
                        ),
                      ),
                    }))
                  : data.parts,
              );
          };
          task.onerror = () => {
            finish();
            reject(Error("Не удалось запустить локальный CAD-модуль."));
          };
          task.postMessage(
            {
              format: ["iges", "igs"].includes(ext)
                ? "iges"
                : ["brep", "brp"].includes(ext)
                  ? "brep"
                  : "step",
              buffer,
            },
            [buffer],
          );
        });
      else {
        const scale = unit === "mm" ? 0.001 : unit === "cm" ? 0.01 : 1;
        const data =
          ext === "obj"
            ? parseOBJ(
                new TextDecoder("utf-8", { fatal: true }).decode(buffer),
                scale,
              )
            : ext === "stl"
              ? parseSTL(buffer, scale)
              : null;
        if (!data)
          throw Error(
            "Формат не поддерживается. Экспортируйте OBJ, STL, STEP, IGES или BREP в исходной программе.",
          );
        parts = [{ ...data, name: file.name.replace(/\.[^.]+$/, "") }];
      }
      await awaitGeometryCommits();
      if (cancelled.current) return;
      if (useEditor.getState().project !== started)
        throw Error("Документ изменился во время импорта. Повторите операцию.");
      const result = useEditor.getState().importPolygons(parts);
      if (result.status === "rejected") throw Error(result.error);
      onImported();
      onClose();
    } catch (e) {
      if (!cancelled.current)
        setError(e instanceof Error ? e.message : "Ошибка импорта.");
    } finally {
      if (!cancelled.current) setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="home-dialog import-dialog"
      aria-labelledby="import-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <h2 id="import-title">Импорт модели</h2>
      <p>
        {file.name} · {(file.size / 1024).toFixed(1)} КБ
      </p>
      {cad && !brep ? (
        <p>
          STEP / IGES: единицы читаются из файла. Криволинейные поверхности
          преобразуются в редактируемые треугольные грани; история CAD и
          аналитические поверхности не сохраняются.
        </p>
      ) : (
        <label>
          Единицы исходного файла
          <select
            aria-label="Единицы импортируемой модели"
            value={unit}
            disabled={busy}
            onChange={(e) => setUnit(e.target.value as typeof unit)}
          >
            <option value="mm">Миллиметры</option>
            <option value="cm">Сантиметры</option>
            <option value="m">Метры</option>
          </select>
        </label>
      )}
      {brep && (
        <p>
          BREP не задаёт единицы: укажите их явно. Поверхности преобразуются в
          грани сетки.
        </p>
      )}
      <p>
        Добавление в текущий проект с Undo. Максимум 20 МБ, 3000 граней.
        Материалы и текстуры исходного файла пока не импортируются.
      </p>
      <p>
        Для .blend, .m3d, .sldprt и .f3d используйте экспорт OBJ/STL или STEP в
        исходной программе.
      </p>
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">Обработка геометрии…</p>}
      <div className="home-dialog-actions">
        <button onClick={close}>{busy ? "Отменить импорт" : "Отмена"}</button>
        <button className="primary" disabled={busy} onClick={() => void run()}>
          Импортировать
        </button>
      </div>
    </dialog>
  );
}
