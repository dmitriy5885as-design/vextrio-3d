import { useEffect, useRef, useState } from "react";
import {
  useEditor,
  usePrecision,
  useGeometryPreview,
  GeometryDocumentCommand,
  isGeometryLocked,
} from "@forma/editor";
import {
  geometryContext,
  validateProject,
  type ProjectV2,
} from "@forma/document";
import {
  GeometrySession,
  createLocalGeometryBackend,
  id,
  moveSelection,
  type Vec3,
  type GeometryIntent,
} from "@forma/geometry";
import { parseDimension, formatDimension } from "@forma/snapping";
import "./sketch.css";
const axisVector = (axis: string): Vec3 =>
  axis === "X" ? [1, 0, 0] : axis === "Y" ? [0, 1, 0] : [0, 0, 1];
export function RotatePanel() {
  const s = useEditor(),
    precision = usePrecision(),
    project = s.project;
  const [axis, setAxis] = useState("Z"),
    [angle, setAngle] = useState("90"),
    [origin, setOrigin] = useState<[string, string, string]>(["0", "0", "0"]),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  const ticket = useRef(0),
    busy = useRef(false),
    selection = s.topologySelections.length
      ? s.topologySelections
      : s.topologySelection
        ? [s.topologySelection]
        : [];
  const refs = selection.filter(
    (r) => r.kind === "vertex" || r.kind === "edge" || r.kind === "face",
  );
  const path = JSON.stringify(precision.path),
    revision = s.revision;
  const allowed =
    project.schemaVersion === 2 &&
    refs.length > 0 &&
    refs.every(
      (r) =>
        r.definitionId === refs[0].definitionId &&
        r.geometryId === refs[0].geometryId &&
        JSON.stringify(r.occurrencePath) === path,
    );
  const parseOrigin = (): Vec3 =>
    origin.map((v) => parseDimension(v, project.units, true)) as Vec3;
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
    const radians = (Number(angle.trim().replace(",", ".")) * Math.PI) / 180;
    if (!Number.isFinite(radians) || Math.abs(radians) > Math.PI * 200)
      throw Error("Угол должен быть в диапазоне ±36000°.");
    return {
      kind: "rotate-vertices",
      vertexIds: selectedVertexIds(),
      origin: parseOrigin(),
      axis: axisVector(axis),
      angle: radians,
    };
  };
  const signature = JSON.stringify([
    project,
    revision,
    refs,
    axis,
    angle,
    origin,
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
          id("rotate-preview/" + crypto.randomUUID()),
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
          "Предпросмотр вращения",
          ref,
          result.change,
        ).execute(project);
        validateProject(candidate);
        useGeometryPreview.setState({
          document: candidate as ProjectV2,
          revision,
          owner: "rotate",
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
          useEditor.getState().tool === "rotate" &&
          token === ticket.current,
        "Вращение вершин",
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
      if (e.key === "Escape" && s.tool === "rotate") {
        s.setTool("select");
      } else if (
        e.key === "Enter" &&
        s.tool === "rotate" &&
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
    <div
      className="sketch-panel"
      data-testid="rotate-panel"
      aria-busy={pending}
    >
      <div className="sketch-title">
        <strong>Вращение · Q</strong>
        <button onClick={() => s.setTool("select")}>Отмена · Esc</button>
      </div>
      <p>
        Вращает выбранные вершины, рёбра или грани в локальных координатах
        активного контекста. Preview проверяет модель до записи.
      </p>
      <div className="rotate-origin">
        {(["X", "Y", "Z"] as const).map((label, i) => (
          <label key={label}>
            {label}
            <input
              aria-label={`Центр вращения ${label}`}
              value={origin[i]}
              onChange={(e) =>
                setOrigin(
                  (old) =>
                    old.map((v, j) => (j === i ? e.target.value : v)) as [
                      string,
                      string,
                      string,
                    ],
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
      <label>
        Ось
        <select
          aria-label="Ось вращения"
          value={axis}
          onChange={(e) => setAxis(e.target.value)}
        >
          <option>X</option>
          <option>Y</option>
          <option>Z</option>
        </select>
      </label>
      <label>
        Угол, °
        <input
          aria-label="Угол вращения"
          value={angle}
          onChange={(e) => setAngle(e.target.value)}
        />
      </label>
      {allowed && (
        <output>
          {refs.length} элементов · {Number(angle.replace(",", "."))}°
        </output>
      )}
      <button disabled={!allowed || pending} onClick={() => void commit()}>
        Повернуть · Enter
      </button>
      {error && (
        <p role="alert" className="sketch-error">
          {error}
        </p>
      )}
    </div>
  );
}
