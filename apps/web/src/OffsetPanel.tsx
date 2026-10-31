import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  useEditor,
  usePrecision,
  useOffset,
  useGeometryPreview,
  GeometryDocumentCommand,
  isGeometryLocked,
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
} from "@forma/geometry";
import { parseDimension, formatDimension } from "@forma/snapping";
import "./sketch.css";
export function OffsetPanel() {
  const s = useEditor(),
    precision = usePrecision(),
    operation = useOffset(),
    preview = useGeometryPreview(),
    [text, setText] = useState("200 mm"),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [busy, setBusy] = useState(false),
    [shared, setShared] = useState(false),
    generation = useRef(0),
    inFlight = useRef(false),
    field = useRef<HTMLInputElement>(null),
    handled = useRef(operation.commitId),
    commitRef = useRef<(pointer?: boolean) => Promise<void>>(async () => {}),
    p = s.project,
    ref = s.topologySelection?.kind === "face" ? s.topologySelection : null,
    key = JSON.stringify(ref),
    pathKey = JSON.stringify(precision.path),
    occurrences = p.schemaVersion === 2 && ref ? definitionOccurrences(p) : [],
    count = ref
      ? occurrences.filter((o) => o.definitionId === ref.definitionId).length
      : 0;
  const checkSource = () => {
    if (p.schemaVersion !== 2 || !ref)
      throw Error("Сначала выберите одну грань.");
    if (JSON.stringify(ref.occurrencePath) !== pathKey)
      throw Error("Сначала войдите в группу двойным щелчком в режиме выбора.");
    if (s.topologySelections.length !== 1)
      throw Error("Для Offset выберите одну грань.");
    const occurrence = occurrences.find(
      (o) => JSON.stringify(o.path) === pathKey,
    );
    if (!occurrence?.visible || isGeometryLocked(p, ref))
      throw Error("Контекст скрыт или заблокирован.");
  };
  useLayoutEffect(() => {
    if (
      operation.gesture &&
      !useOffset.getState().editing &&
      document.activeElement !== field.current
    )
      setText(String(operation.gesture.distance) + "m");
  }, [operation.gesture?.distance, operation.gesture?.ref.entityId]);
  useEffect(() => {
    setShared(false);
  }, [key]);
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (
        !ref ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        e.repeat ||
        (e.target as HTMLElement).matches("input,select,textarea,button")
      )
        return;
      if (/^[0-9.,+\-]$/.test(e.key)) {
        e.preventDefault();
        setText(e.key);
        field.current?.focus();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [key]);
  useEffect(() => {
    const ticket = ++generation.current;
    useGeometryPreview.setState({ document: null, owner: "offset" });
    setError("");
    setPending(false);
    if (p.schemaVersion !== 2 || !ref) return;
    if (operation.gesture && text === "0m") return;
    let session: GeometrySession | undefined;
    const timer = setTimeout(async () => {
      try {
        checkSource();
        const distance = parseDimension(text, p.units, true),
          context = geometryContext(
            p,
            ref.geometryId,
            true,
            ref.occurrencePath,
          );
        setPending(true);
        session = new GeometrySession(
          p.geometries[ref.geometryId],
          context,
          createLocalGeometryBackend(context),
          id("offset-preview/" + crypto.randomUUID()),
        );
        const result = await session.prepare({
          kind: "offset-face",
          faceId: ref.entityId,
          distance,
        });
        if (ticket !== generation.current) return;
        if (result.status !== "preview")
          throw Error(
            result.status === "error"
              ? result.diagnostics[0].message
              : result.status === "noop"
                ? "Такой контур уже существует."
                : "Предпросмотр отменён.",
          );
        const candidate = new GeometryDocumentCommand(
          "Предпросмотр Offset",
          ref,
          result.change,
        ).execute(p);
        validateProject(candidate);
        useGeometryPreview.setState({
          document: candidate as ProjectV2,
          revision: s.revision,
          owner: "offset",
        });
      } catch (e) {
        if (ticket === generation.current)
          setError(e instanceof Error ? e.message : "Ошибка Offset.");
      } finally {
        if (ticket === generation.current) setPending(false);
      }
    }, 100);
    return () => {
      generation.current++;
      clearTimeout(timer);
      session?.cancelAll();
      if (useGeometryPreview.getState().owner === "offset")
        useGeometryPreview.setState({ document: null, owner: null });
    };
  }, [key, s.revision, pathKey, text, p.units, s.topologySelections.length]);
  const commit = async (fromPointer = false) => {
    if (inFlight.current || busy) return;
    const gesture = fromPointer ? useOffset.getState().gesture : null;
    try {
      checkSource();
      if (!ref) throw Error("Сначала выберите грань.");
      if (count > 1 && !shared)
        throw Error(
          "Подтвердите изменение всех экземпляров общего компонента.",
        );
      if (fromPointer && (!gesture || JSON.stringify(gesture.ref) !== key))
        throw Error("Контекст Offset изменился.");
      const distance = gesture
          ? gesture.distance
          : parseDimension(text, p.units, true),
        ticket = ++generation.current;
      inFlight.current = true;
      useOffset.setState({ committing: true });
      setBusy(true);
      setError("");
      useGeometryPreview.setState({ document: null, owner: null });
      const result = await s.editGeometry(
        ref,
        { kind: "offset-face", faceId: ref.entityId, distance },
        () =>
          useEditor.getState().tool === "offset" &&
          JSON.stringify(usePrecision.getState().path) === pathKey &&
          useOffset.getState().committing &&
          (gesture
            ? useOffset.getState().gesture === gesture
            : ticket === generation.current),
      );
      if (result.status === "rejected") throw Error(result.error);
      useOffset.getState().cancel();
      useEditor.getState().selectEntity(null);
      useEditor
        .getState()
        .notify(
          result.status === "noop"
            ? "Контур уже существует."
            : "Offset построен",
        );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Offset не выполнен.");
    } finally {
      inFlight.current = false;
      useOffset.setState({ committing: false });
      setBusy(false);
    }
  };
  commitRef.current = commit;
  useEffect(() => {
    if (operation.commitId === handled.current) return;
    handled.current = operation.commitId;
    void commitRef.current(true);
  }, [operation.commitId]);
  if (p.schemaVersion !== 2) return null;
  const candidate =
    preview.owner === "offset" && preview.revision === s.revision
      ? preview.document
      : null;
  return (
    <div className="sketch-panel" data-testid="offset-panel" aria-busy={busy}>
      <div className="sketch-title">
        <strong>Отступ контура · F</strong>
        <button onClick={() => s.setTool("select")}>Отмена · Esc</button>
      </div>
      {!ref ? (
        <p>
          Щёлкните грань у нужного ребра, переместите мышь и щёлкните для
          завершения. Или предварительно выберите грань и введите отступ.
        </p>
      ) : (
        <>
          <p>
            {operation.gesture
              ? "Переместите мышь и щёлкните для завершения. Можно ввести точный отступ."
              : "Положительный отступ — внутрь области; отрицательный — наружу."}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void commit();
            }}
          >
            <label>
              Отступ
              <input
                ref={field}
                aria-label="Размер отступа"
                value={text}
                disabled={busy}
                aria-invalid={!!error}
                onChange={(e) => {
                  setText(e.target.value);
                  setError("");
                }}
                onFocus={() => useOffset.setState({ editing: true })}
                onBlur={() => useOffset.setState({ editing: false })}
                onKeyDown={(e) => {
                  if (e.repeat && e.key === "Enter") e.preventDefault();
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    s.setTool("select");
                    s.select(null);
                  }
                }}
              />
            </label>
            <button type="submit" disabled={busy}>
              Применить · Enter
            </button>
          </form>
          {pending ? (
            <p>Проверяем контуры и пересечения…</p>
          ) : candidate ? (
            <p data-testid="offset-preview">
              Геометрия проверена · граней:{" "}
              {Object.values(candidate.geometries).reduce(
                (n, g) => n + Object.keys(g.faces).length,
                0,
              )}
            </p>
          ) : (
            <p>Предпросмотр не изменяет документ.</p>
          )}
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
          <small>
            Offset сохраняет исходный контур и центральную грань. Для замкнутых
            стен удалите центральную грань перед вытягиванием кольца.
          </small>
          <output>
            {(() => {
              try {
                return formatDimension(
                  parseDimension(text, p.units, true),
                  p.units,
                );
              } catch {
                return "";
              }
            })()}
          </output>
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
