import { useEffect, useMemo, useRef, useState } from "react";
import {
  useEditor,
  useVolumePreview,
  isGeometryLocked,
  GeometryDocumentCommand,
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
      side: outwardSide as 1 | -1,
    };
  }
  useEffect(() => {
    const ticket = ++generation.current;
    useVolumePreview.setState({ document: null });
    setError("");
    setPending(false);
    if (!active || p.schemaVersion !== 2 || !ref) return;
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
  if (!active || p.schemaVersion !== 2) return null;
  const occurrences = ref
    ? definitionOccurrences(p).filter(
        (o) => o.definitionId === ref.definitionId,
      ).length
    : 0;
  const preview = previewState.document;
  const body =
    ref && preview
      ? Object.values(preview.geometries[ref.geometryId].bodies).find((b) =>
          b.faceIds.includes(ref.entityId as never),
        )
      : null;
  const volume =
    body && preview && ref
      ? bodyVolume(
          preview.geometries[ref.geometryId],
          body.id,
          occurrenceMatrix(preview, ref.occurrencePath),
        )
      : null;
  const commit = async () => {
    if (
      !ref ||
      busy ||
      pending ||
      error ||
      s.topologySelections.length !== 1 ||
      (occurrences > 1 && !shared)
    )
      return;
    const ticket = generation.current;
    try {
      setBusy(true);
      const result = await s.editGeometry(
        ref,
        intent(),
        () =>
          ticket === generation.current &&
          useEditor.getState().tool === "extrude",
      );
      if (result.status === "rejected") throw Error(result.error);
      useVolumePreview.setState({ document: null });
      useEditor.getState().setTool("select");
      useEditor.getState().selectEntity(ref);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось изменить объём");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="sketch-panel" data-testid="extrude-panel">
      <div className="sketch-title">
        <strong>Вытянуть / вдавить · P</strong>
        <button onClick={() => s.setTool("select")}>Отмена · Esc</button>
      </div>
      {!ref ? (
        <p>Выберите грань в сцене. Затем задайте высоту.</p>
      ) : (
        <>
          <p>Положительная высота — наружу; отрицательная — обратно.</p>
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
                onKeyDown={(e) => {
                  if (e.repeat && e.key === "Enter") e.preventDefault();
                  if (e.key === "Escape") {
                    e.preventDefault();
                    s.setTool("select");
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
