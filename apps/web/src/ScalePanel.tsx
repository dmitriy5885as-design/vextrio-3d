import { useEffect, useRef, useState } from "react";
import {
  GeometryDocumentCommand,
  isGeometryLocked,
  useEditor,
  useGeometryPreview,
  usePrecision,
} from "@forma/editor";
import {
  geometryContext,
  validateProject,
  type ProjectV2,
} from "@forma/document";
import {
  createLocalGeometryBackend,
  GeometrySession,
  id,
  moveSelection,
  type GeometryIntent,
  type Vec3,
} from "@forma/geometry";
import { formatDimension, parseDimension } from "@forma/snapping";
import "./sketch.css";

export function ScalePanel() {
  const s = useEditor(),
    precision = usePrecision(),
    project = s.project;
  const [origin, setOrigin] = useState<[string, string, string]>([
      "0",
      "0",
      "0",
    ]),
    [factors, setFactors] = useState<[string, string, string]>(["1", "1", "1"]),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  const ticket = useRef(0),
    busy = useRef(false),
    selection = s.topologySelections.length
      ? s.topologySelections
      : s.topologySelection
        ? [s.topologySelection]
        : [],
    refs = selection.filter(
      (r) => r.kind === "vertex" || r.kind === "edge" || r.kind === "face",
    );
  const path = JSON.stringify(precision.path),
    revision = s.revision,
    allowed =
      project.schemaVersion === 2 &&
      refs.length > 0 &&
      refs.every(
        (r) =>
          r.definitionId === refs[0].definitionId &&
          r.geometryId === refs[0].geometryId &&
          JSON.stringify(r.occurrencePath) === path,
      );
  const parseOrigin = (): Vec3 =>
    origin.map((value) => parseDimension(value, project.units, true)) as Vec3;
  const selectedVertexIds = () => {
    const ref = refs[0],
      geometry = (project as ProjectV2).geometries[ref.geometryId];
    if (!geometry) throw Error("Геометрия контекста не найдена.");
    return [
      ...moveSelection(
        geometry,
        refs.map((item) => ({
          kind: item.kind as "vertex" | "edge" | "face",
          id: item.entityId,
        })),
      ).vertices,
    ];
  };
  const getIntent = (): GeometryIntent => {
    if (!allowed)
      throw Error("Выберите вершины, рёбра или грани одного контекста.");
    const values = factors.map((value) =>
      Number(value.trim().replace(",", ".")),
    ) as Vec3;
    if (
      !values.every(
        (value) => Number.isFinite(value) && value >= 1e-6 && value <= 1e6,
      )
    )
      throw Error("Масштаб по каждой оси должен быть от 0,000001 до 1000000.");
    return {
      kind: "scale-vertices",
      vertexIds: selectedVertexIds(),
      origin: parseOrigin(),
      factors: values,
    };
  };
  const signature = JSON.stringify([
    project,
    revision,
    refs,
    origin,
    factors,
    path,
  ]);
  useEffect(() => {
    const current = ++ticket.current;
    setError("");
    setPending(false);
    if (!allowed) return;
    let session: GeometrySession | undefined;
    const timer = setTimeout(async () => {
      try {
        const ref = refs[0];
        if (isGeometryLocked(project as ProjectV2, ref))
          throw Error("Контекст заблокирован.");
        const context = geometryContext(
          project as ProjectV2,
          ref.geometryId,
          true,
          path ? JSON.parse(path) : [],
        );
        session = new GeometrySession(
          (project as ProjectV2).geometries[ref.geometryId],
          context,
          createLocalGeometryBackend(context),
          id("scale-preview/" + crypto.randomUUID()),
        );
        setPending(true);
        const result = await session.prepare(getIntent());
        if (current !== ticket.current) return;
        if (result.status !== "preview")
          throw Error(
            result.status === "error"
              ? result.diagnostics[0].message
              : "Нет изменения геометрии.",
          );
        const candidate = new GeometryDocumentCommand(
          "Предпросмотр масштабирования",
          ref,
          result.change,
        ).execute(project);
        validateProject(candidate);
        useGeometryPreview.setState({
          document: candidate as ProjectV2,
          revision,
          owner: "scale",
        });
      } catch (e) {
        if (current === ticket.current) setError((e as Error).message);
      } finally {
        if (current === ticket.current) setPending(false);
      }
    }, 120);
    return () => {
      ticket.current++;
      clearTimeout(timer);
      session?.cancelAll();
      useGeometryPreview.setState({ document: null, owner: null });
    };
  }, [signature, allowed]);
  const commit = async () => {
    if (busy.current) return;
    try {
      if (!allowed)
        throw Error("Выберите вершины, рёбра или грани одного контекста.");
      const intent = getIntent(),
        ref = refs[0],
        token = ++ticket.current;
      busy.current = true;
      const result = await s.editGeometry(
        ref,
        intent,
        () =>
          useEditor.getState().revision === revision &&
          useEditor.getState().tool === "scale" &&
          token === ticket.current,
        "Масштабирование геометрии",
      );
      if (result.status === "rejected") throw Error(result.error);
      useGeometryPreview.setState({ document: null, owner: null });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busy.current = false;
    }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && s.tool === "scale") s.setTool("select");
      else if (
        e.key === "Enter" &&
        s.tool === "scale" &&
        !(e.target as HTMLElement).matches("input,button,select")
      ) {
        e.preventDefault();
        void commit();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [signature]);
  if (project.schemaVersion !== 2) return null;
  return (
    <div className="sketch-panel" data-testid="scale-panel" aria-busy={pending}>
      <div className="sketch-title">
        <strong>Масштаб · S</strong>
        <button onClick={() => s.setTool("select")}>Отмена · Esc</button>
      </div>
      <p>
        Масштабирует выбранные вершины, рёбра или грани в локальных координатах
        активного контекста. Отрицательные значения и нулевой масштаб запрещены;
        для отражения будет отдельная команда.
      </p>
      <fieldset>
        <legend>Коэффициенты по осям</legend>
        <div className="rotate-origin">
          {(["X", "Y", "Z"] as const).map((label, i) => (
            <label key={label}>
              {label}
              <input
                aria-label={`Масштаб ${label}`}
                value={factors[i]}
                onChange={(e) =>
                  setFactors(
                    (old) =>
                      old.map((value, j) =>
                        j === i ? e.target.value : value,
                      ) as [string, string, string],
                  )
                }
              />
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Центр масштабирования · локальные координаты</legend>
        <div className="rotate-origin">
          {(["X", "Y", "Z"] as const).map((label, i) => (
            <label key={label}>
              {label}
              <input
                aria-label={`Центр масштабирования ${label}`}
                value={origin[i]}
                onChange={(e) =>
                  setOrigin(
                    (old) =>
                      old.map((value, j) =>
                        j === i ? e.target.value : value,
                      ) as [string, string, string],
                  )
                }
              />
            </label>
          ))}
        </div>
        <button
          onClick={() => {
            const ref = s.topologySelection;
            if (ref?.kind !== "vertex" || project.schemaVersion !== 2) {
              setError("Выберите вершину опоры.");
              return;
            }
            const vertex =
              project.geometries[ref.geometryId]?.vertices[ref.entityId];
            if (!vertex) {
              setError("Опорная вершина не найдена.");
              return;
            }
            setOrigin(
              vertex.position.map((v) => formatDimension(v, project.units)) as [
                string,
                string,
                string,
              ],
            );
            setError("");
          }}
        >
          Центр из выбранной вершины
        </button>
      </fieldset>
      {allowed && <output>{refs.length} элементов</output>}
      <button disabled={!allowed || pending} onClick={() => void commit()}>
        Масштабировать · Enter
      </button>
      {error && (
        <p role="alert" className="sketch-error">
          {error}
        </p>
      )}
    </div>
  );
}
