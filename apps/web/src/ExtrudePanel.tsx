import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  useEditor,
  useVolumePreview,
  isGeometryLocked,
  GeometryDocumentCommand,
  usePushPull,
} from "@forma/editor";
import {
  geometryContext,
  occurrenceMatrix,
  definitionOccurrences,
  validateProject,
  type ProjectV2,
} from "@forma/document";
import {
  GeometrySession,
  createLocalGeometryBackend,
  id,
  affinePlane,
  dot,
  subtract,
  bodyVolume,
  classifyBody,
  extrusionStop,
  type GeometryIntent,
} from "@forma/geometry";
import { parseDimension } from "@forma/snapping";
import "./sketch.css";
export function ExtrudePanel() {
  const s = useEditor(),
    [text, setText] = useState("3 m"),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [busy, setBusy] = useState(false),
    [shared, setShared] = useState(false),
    generation = useRef(0),
    field = useRef<HTMLInputElement>(null);
  const p = s.project,
    ref = s.topologySelection?.kind === "face" ? s.topologySelection : null;
  const active = s.tool === "extrude";
  const previewState = useVolumePreview();
  const pointer = usePushPull(),
    inFlight = useRef(false),
    commitRef = useRef<(fromPointer?: boolean) => Promise<void>>(
      async () => {},
    ),
    handledCommit = useRef(pointer.commitId);
  // Flush gesture distance before the browser can focus/select the field.
  // A passive effect could replace the selected text after focus and splice
  // the user's first characters into a late "0m" value (for example "0m2m").
  useLayoutEffect(() => {
    if (
      pointer.gesture &&
      !usePushPull.getState().editing &&
      document.activeElement !== field.current
    )
      setText(String(pointer.gesture.distance) + "m");
  }, [pointer.gesture?.distance, pointer.gesture?.ref.entityId]);
  // Capture the visible sheet side when the face/context changes, not while
  // orbiting the preview, so the confirmed result cannot flip with the camera.
  const outwardSide = useMemo(() => {
    if (p.schemaVersion !== 2 || !ref) return 1;
    const g = p.geometries[ref.geometryId],
      f = g.faces[ref.entityId],
      body = Object.values(g.bodies).find((b) => b.faceIds.includes(f.id));
    const plane = affinePlane(f.plane, occurrenceMatrix(p, ref.occurrencePath));
    return body && classifyBody(g, body.id) === "closed-shell"
      ? (body.shellIds
          .flatMap((s) => g.shells[s].faces)
          .find((use) => use.faceId === f.id)?.orientation ?? 1)
      : dot(subtract(p.camera.position, plane.origin), plane.normal) >= 0
        ? 1
        : -1;
  }, [s.revision, ref?.entityId, JSON.stringify(ref?.occurrencePath)]);
  function intent(): GeometryIntent {
    if (p.schemaVersion !== 2 || !ref)
      throw Error("Сначала выберите одну грань.");
    return {
      kind: "extrude-face",
      faceId: ref.entityId,
      distance: parseDimension(text, p.units, true),
      side: pointer.gesture?.side ?? (outwardSide as 1 | -1),
    };
  }
  useEffect(() => {
    const ticket = ++generation.current;
    useVolumePreview.setState({ document: null });
    setError("");
    setPending(false);
    if (!active || p.schemaVersion !== 2 || !ref) return;
    if (pointer.gesture && Number(text.replace(/m$/, "")) === 0) return;
    let session: GeometrySession | undefined;
    const timer = setTimeout(async () => {
      try {
        if (isGeometryLocked(p, ref))
          throw Error("Группа или один из экземпляров заблокирован.");
        const request = intent(),
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
          id("volume-preview/" + crypto.randomUUID()),
        );
        const result = await session.prepare(request);
        if (ticket !== generation.current) return;
        if (result.status !== "preview")
          throw Error(
            result.status === "error"
              ? result.diagnostics[0].message
              : "Нет результата предпросмотра.",
          );
        const candidate = new GeometryDocumentCommand(
          "Предпросмотр объёма",
          ref,
          result.change,
        ).execute(p);
        validateProject(candidate);
        useVolumePreview.setState({
          document: candidate as ProjectV2,
          revision: s.revision,
          owner: "extrude",
        });
      } catch (e) {
        if (ticket === generation.current)
          setError(e instanceof Error ? e.message : "Ошибка геометрии");
      } finally {
        if (ticket === generation.current) setPending(false);
      }
    }, 120);
    return () => {
      generation.current++;
      clearTimeout(timer);
      session?.cancelAll();
      useVolumePreview.setState({ document: null });
    };
  }, [
    active,
    s.revision,
    ref?.entityId,
    JSON.stringify(ref?.occurrencePath),
    text,
    p.units,
  ]);
  useEffect(() => {
    setShared(false);
  }, [ref?.entityId, JSON.stringify(ref?.occurrencePath)]);
  const occurrences =
    ref && p.schemaVersion === 2
      ? definitionOccurrences(p).filter(
          (o) => o.definitionId === ref.definitionId,
        ).length
      : 0;
  const preview = previewState.document;
  const body =
    ref && preview && p.schemaVersion === 2
      ? preview.geometries[ref.geometryId].bodies[
          Object.values(p.geometries[ref.geometryId].bodies).find((b) =>
            b.faceIds.includes(ref.entityId as never),
          )?.id ?? ""
        ]
      : null;
  const volume = useMemo(
    () =>
      body && preview && ref
        ? bodyVolume(
            preview.geometries[ref.geometryId],
            body.id,
            occurrenceMatrix(preview, ref.occurrencePath),
          )
        : null,
    [body, preview, ref?.geometryId, JSON.stringify(ref?.occurrencePath)],
  );
  const commit = async (fromPointer = false) => {
    if (
      !ref ||
      inFlight.current ||
      busy ||
      (!fromPointer && (pending || error)) ||
      s.topologySelections.length !== 1 ||
      (occurrences > 1 && !shared)
    ) {
      if (fromPointer && !inFlight.current && !busy)
        usePushPull.setState({ committing: false });
      return;
    }
    const ticket = generation.current;
    const gesture = fromPointer ? usePushPull.getState().gesture : null;
    if (fromPointer && !gesture) {
      usePushPull.setState({ committing: false });
      return;
    }
    const wasPointer = !!pointer.gesture;
    try {
      if (
        gesture &&
        (gesture.ref.entityId !== ref.entityId ||
          gesture.ref.geometryId !== ref.geometryId ||
          JSON.stringify(gesture.ref.occurrencePath) !==
            JSON.stringify(ref.occurrencePath))
      )
        throw Error("Контекст подтверждённой операции изменился.");
      inFlight.current = true;
      if (wasPointer) usePushPull.setState({ committing: true });
      setBusy(true);
      const result = await s.editGeometry(
        ref,
        gesture
          ? {
              kind: "extrude-face",
              faceId: ref.entityId,
              distance: gesture.distance,
              side: gesture.side,
            }
          : intent(),
        () =>
          (gesture
            ? usePushPull.getState().gesture === gesture &&
              usePushPull.getState().committing
            : ticket === generation.current) &&
          useEditor.getState().tool === "extrude",
      );
      if (result.status === "rejected") throw Error(result.error);
      useVolumePreview.setState({ document: null });
      usePushPull.getState().cancel();
      if (!wasPointer) useEditor.getState().setTool("select");
      const after = useEditor.getState().project;
      useEditor
        .getState()
        .selectEntity(
          !wasPointer &&
            after.schemaVersion === 2 &&
            after.geometries[ref.geometryId].faces[ref.entityId]
            ? ref
            : null,
        );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось изменить объём");
    } finally {
      inFlight.current = false;
      usePushPull.setState({ committing: false });
      setBusy(false);
    }
  };
  commitRef.current = commit;
  useEffect(() => {
    if (pointer.commitId === handledCommit.current) return;
    handledCommit.current = pointer.commitId;
    if (!ref || (occurrences > 1 && !shared)) {
      usePushPull.setState({ committing: false });
      return;
    }
    void commitRef.current(true);
  }, [pointer.commitId, ref?.entityId, shared]);
  const limit = useMemo(
    () =>
      ref && p.schemaVersion === 2
        ? extrusionStop(
            p.geometries[ref.geometryId],
            p.geometries[ref.geometryId].faces[ref.entityId],
            outwardSide as 1 | -1,
            geometryContext(p, ref.geometryId, true, ref.occurrencePath),
          )
        : null,
    [
      s.revision,
      ref?.entityId,
      JSON.stringify(ref?.occurrencePath),
      outwardSide,
    ],
  );
  if (!active || p.schemaVersion !== 2) return null;
  return (
    <div className="sketch-panel" data-testid="extrude-panel">
      <div className="sketch-title">
        <strong>Вытянуть / вдавить · P</strong>
        <button onClick={() => s.setTool("select")}>Отмена · Esc</button>
      </div>
      {!ref ? (
        <p>
          Щёлкните грань, переместите мышь, щёлкните ещё раз. Или предварительно
          выберите грань и введите размер.
        </p>
      ) : (
        <>
          <p>
            {pointer.gesture
              ? "Переместите мышь и щёлкните для завершения. Можно ввести точную глубину."
              : "Положительная высота — наружу; отрицательная — обратно."}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void commit();
            }}
          >
            <label>
              Высота
              <input
                ref={field}
                aria-label="Высота выдавливания"
                value={text}
                disabled={busy}
                aria-invalid={!!error}
                onChange={(e) => setText(e.target.value)}
                onFocus={() => usePushPull.setState({ editing: true })}
                onBlur={() => usePushPull.setState({ editing: false })}
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
            <button
              type="submit"
              disabled={
                busy ||
                pending ||
                !!error ||
                (occurrences > 1 && !shared) ||
                s.topologySelections.length !== 1
              }
            >
              Применить · Enter
            </button>
          </form>
          {limit && (
            <button onClick={() => setText(String(limit.distance) + "m")}>
              До противоположной грани · {Number((-limit.distance).toFixed(6))}{" "}
              м
            </button>
          )}
          {occurrences > 1 && (
            <label>
              <input
                type="checkbox"
                checked={shared}
                onChange={(e) => setShared(e.target.checked)}
              />
              Изменить все {occurrences} экземпляра
            </label>
          )}
          {pending ? (
            <p>Проверяем грани и пересечения…</p>
          ) : volume !== null ? (
            <p data-testid="volume-preview">
              Объём: {Number(volume.toFixed(8))} м³
            </p>
          ) : (
            <p>Предпросмотр не изменяет документ.</p>
          )}
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
