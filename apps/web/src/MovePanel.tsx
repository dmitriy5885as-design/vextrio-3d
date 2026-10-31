import { useEffect, useRef, useState } from "react";
import {
  useEditor,
  useMove,
  usePrecision,
  precisionFrame,
  isGeometryLocked,
  GeometryDocumentCommand,
  useGeometryPreview,
} from "@forma/editor";
import {
  definitionOccurrences,
  geometryContext,
  validateProject,
  type ProjectV2,
} from "@forma/document";
import {
  GeometrySession,
  createLocalGeometryBackend,
  id,
  subtract,
  length,
  type Vec3,
} from "@forma/geometry";
import { resolvePrecision, formatDimension } from "@forma/snapping";
import "./sketch.css";
export function MovePanel() {
  const s = useEditor(),
    m = useMove(),
    p = usePrecision(),
    g = m.gesture,
    project = s.project;
  const [text, setText] = useState(""),
    [mode, setMode] = useState<"length" | "coordinates">("length"),
    [relative, setRelative] = useState(true),
    [shared, setShared] = useState(false),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [busy, setBusy] = useState(false);
  const ticket = useRef(0),
    inFlight = useRef(false),
    handled = useRef(m.commitId),
    commitRef = useRef<(pointer?: boolean) => Promise<void>>(async () => {}),
    field = useRef<HTMLInputElement>(null);
  const ref = g?.refs[0],
    pathKey = JSON.stringify(p.path),
    count =
      project.schemaVersion === 2 && ref
        ? definitionOccurrences(project).filter(
            (o) => o.definitionId === ref.definitionId,
          ).length
        : 0;
  function source() {
    if (project.schemaVersion !== 2 || !g || !ref)
      throw Error("Укажите опорную точку щелчком по выбранной геометрии.");
    if (
      g.revision !== s.revision ||
      JSON.stringify(ref.occurrencePath) !== pathKey ||
      g.refs.some(
        (r) =>
          r.geometryId !== ref.geometryId ||
          JSON.stringify(r.occurrencePath) !== pathKey,
      )
    )
      throw Error("Выберите геометрию одного активного контекста.");
    const occurrence = definitionOccurrences(project).find(
      (o) => JSON.stringify(o.path) === pathKey,
    );
    if (
      !occurrence?.visible ||
      g.refs.some((r) => isGeometryLocked(project, r))
    )
      throw Error("Геометрия скрыта или заблокирована.");
    return { project, ref, g };
  }
  function target(pointer = false): Vec3 {
    const { g, project } = source();
    if (pointer || !text.trim()) return [...g.target];
    return resolvePrecision({
      text,
      mode,
      relative,
      unit: project.units,
      anchor: g.anchor,
      direction: subtract(g.target, g.anchor),
      ...precisionFrame(project, p),
      system: p.system,
      axis: p.axis,
    }).point;
  }
  function intent(t: Vec3) {
    const { g } = source();
    return {
      kind: "translate-entities" as const,
      entities: g.refs.map((r) => {
        if (r.kind !== "vertex" && r.kind !== "edge" && r.kind !== "face")
          throw Error("Выберите вершину, ребро или грань.");
        return { kind: r.kind, id: r.entityId };
      }),
      delta: subtract(t, g.anchor),
      copy: m.copy,
    };
  }
  useEffect(() => {
    setText("");
    setShared(false);
    setError("");
  }, [m.generation]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.repeat ||
        e.altKey ||
        e.metaKey ||
        (e.target as HTMLElement).matches("input,select,textarea,button")
      )
        return;
      if (e.key === "Control" && g && !useMove.getState().committing) {
        useMove.setState({ copy: !useMove.getState().copy });
        return;
      }
      const axes: Record<string, "X" | "Y" | "Z"> = {
          ArrowRight: "X",
          ArrowLeft: "Z",
          ArrowUp: "Y",
        },
        axis = axes[e.key];
      if (axis) {
        e.preventDefault();
        usePrecision
          .getState()
          .configure({ axis: p.axis === axis ? null : axis });
        return;
      }
      if (g && !e.ctrlKey && /^[0-9.,+\-]$/.test(e.key)) {
        e.preventDefault();
        setText(e.key);
        field.current?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [!!g, p.axis]);
  useEffect(() => {
    const t = ++ticket.current;
    useGeometryPreview.setState({ document: null, owner: "translate" });
    setError("");
    setPending(false);
    if (!g) return;
    let session: GeometrySession | undefined;
    const timer = setTimeout(async () => {
      try {
        const { project, ref } = source(),
          q = target(),
          context = geometryContext(
            project,
            ref.geometryId,
            true,
            ref.occurrencePath,
          );
        if (length(subtract(q, g.anchor)) === 0) return;
        setPending(true);
        session = new GeometrySession(
          project.geometries[ref.geometryId],
          context,
          createLocalGeometryBackend(context),
          id("move-preview/" + crypto.randomUUID()),
        );
        const result = await session.prepare(intent(q));
        if (t !== ticket.current) return;
        if (result.status !== "preview")
          throw Error(
            result.status === "error"
              ? result.diagnostics[0].message
              : "Нет изменения геометрии.",
          );
        const candidate = new GeometryDocumentCommand(
          "Предпросмотр перемещения",
          ref,
          result.change,
        ).execute(project);
        validateProject(candidate);
        useGeometryPreview.setState({
          document: candidate as ProjectV2,
          revision: s.revision,
          owner: "translate",
        });
      } catch (e) {
        if (t === ticket.current)
          setError(e instanceof Error ? e.message : "Ошибка перемещения.");
      } finally {
        if (t === ticket.current) setPending(false);
      }
    }, 90);
    return () => {
      ticket.current++;
      clearTimeout(timer);
      session?.cancelAll();
      if (useGeometryPreview.getState().owner === "translate")
        useGeometryPreview.setState({ document: null, owner: null });
    };
  }, [g, s.revision, text, mode, relative, p.axis, p.system, pathKey, m.copy]);
  async function commit(pointer = false) {
    if (inFlight.current) return;
    try {
      const { ref } = source(),
        q = target(pointer),
        generation = useMove.getState().generation;
      if (count > 1 && !shared)
        throw Error("Подтвердите изменение всех экземпляров компонента.");
      inFlight.current = true;
      setBusy(true);
      useMove.setState({ committing: true });
      ticket.current++;
      setError("");
      const result = await s.editGeometry(
        ref,
        intent(q),
        () =>
          useEditor.getState().tool === "translate" &&
          useMove.getState().generation === generation &&
          useMove.getState().committing,
      );
      if (result.status === "rejected") throw Error(result.error);
      useMove.getState().cancel();
      usePrecision.getState().configure({ enabled: false });
      s.selectEntity(null);
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Перемещение не выполнено.");
    } finally {
      inFlight.current = false;
      useMove.setState({ committing: false });
      setBusy(false);
    }
  }
  commitRef.current = commit;
  useEffect(() => {
    if (m.commitId !== handled.current) {
      handled.current = m.commitId;
      void commitRef.current(true);
    }
  }, [m.commitId]);
  if (project.schemaVersion !== 2) return null;
  return (
    <div className="sketch-panel" data-testid="move-panel" aria-busy={busy}>
      <div className="sketch-title">
        <strong>Перемещение · M</strong>
        <button onClick={() => s.setTool("select")}>Отмена · Esc</button>
      </div>
      {!g ? (
        <p>
          Выберите вершину, ребро или грань. Щёлкните опорную точку, переместите
          мышь и щёлкните для завершения. Shift добавляет элементы в режиме
          выбора.
        </p>
      ) : (
        <>
          <p>
            Стрелки: ↑ Y, → X, ← Z. Повторная стрелка снимает фиксацию. Ctrl —
            копия.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void commit();
            }}
          >
            <label>
              Ввод
              <select
                aria-label="Режим перемещения"
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value as typeof mode);
                  setText("");
                }}
              >
                <option value="length">Расстояние</option>
                <option value="coordinates">Координаты X;Y;Z</option>
              </select>
            </label>
            <label>
              Размер
              <input
                ref={field}
                aria-label="Размер перемещения"
                value={text}
                disabled={busy}
                placeholder={
                  mode === "length" ? "Например 500mm" : "0;1000mm;0"
                }
                onFocus={() => usePrecision.setState({ editing: true })}
                onBlur={() => usePrecision.setState({ editing: false })}
                onChange={(e) => {
                  setText(e.target.value);
                  setError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.repeat) e.preventDefault();
                  if (e.key === "Escape") {
                    e.preventDefault();
                    s.setTool("select");
                  }
                }}
              />
            </label>
            {mode === "coordinates" && (
              <label>
                <input
                  type="checkbox"
                  checked={relative}
                  onChange={(e) => setRelative(e.target.checked)}
                />
                Относительно опорной точки
              </label>
            )}
            <button disabled={busy}>Применить · Enter</button>
          </form>
          <label>
            Ось
            <select
              aria-label="Ось перемещения"
              value={p.axis ?? "free"}
              onChange={(e) =>
                p.configure({
                  axis:
                    e.target.value === "free"
                      ? null
                      : (e.target.value as "X" | "Y" | "Z"),
                })
              }
            >
              {["free", "X", "Y", "Z"].map((v) => (
                <option key={v} value={v}>
                  {v === "free" ? "Свободно" : v}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={m.copy}
              onChange={(e) => useMove.setState({ copy: e.target.checked })}
            />
            Создать копию · Ctrl
          </label>
          {count > 1 && (
            <label>
              <input
                type="checkbox"
                checked={shared}
                onChange={(e) => setShared(e.target.checked)}
              />
              Изменить все {count} экземпляра
            </label>
          )}
          {pending ? (
            <p>Проверяем связанные грани…</p>
          ) : (
            <output>
              {(() => {
                try {
                  return formatDimension(
                    length(subtract(target(), g.anchor)),
                    project.units,
                  );
                } catch {
                  return "";
                }
              })()}
            </output>
          )}
          <small>
            В контексте без поверхностей линии соединяются и делятся при
            контактах. Грань до 128 граничных вершин и 16 отверстий может
            сложиться по новым рёбрам, сохраняя проёмы и плоские участки. Новые
            контакты сначала разделите линиями.
          </small>
        </>
      )}
      {error && (
        <p role="alert" className="sketch-error">
          {error}
        </p>
      )}
    </div>
  );
}
