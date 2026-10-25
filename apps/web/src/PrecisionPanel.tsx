import { useState, useEffect } from "react";
import "./precision.css";
import {
  useEditor,
  usePrecision,
  precisionFrame,
  localPrecisionPoint,
  isGeometryLocked,
} from "@forma/editor";
import {
  definitionOccurrences,
  occurrenceMatrix,
  definitionAtPath,
} from "@forma/document";
import {
  transformAffine,
  affinePlane,
  id,
  inverseAffine,
} from "@forma/geometry";
import {
  formatDimension,
  frameMatrix,
  type CoordinateSystem,
  type PlaneName,
  type PrecisionInput,
} from "@forma/snapping";
export function PrecisionPanel() {
  const editor = useEditor(),
    state = usePrecision(),
    [text, setText] = useState(""),
    [mode, setMode] = useState<PrecisionInput["mode"]>("coordinates"),
    [relative, setRelative] = useState(false),
    [busy, setBusy] = useState(false),
    [sharedConfirmed, setSharedConfirmed] = useState(false);
  const p = editor.project;
  useEffect(() => {
    setSharedConfirmed(false);
    if (p.schemaVersion !== 2) {
      usePrecision.getState().configure({ enabled: false, path: [] });
      return;
    }
    try {
      definitionAtPath(p, usePrecision.getState().path);
    } catch {
      usePrecision.getState().configure({ path: [] });
    }
  }, [p.schemaVersion, editor.topologySelection]);
  if (p.schemaVersion !== 2) return null;
  const occurrences = definitionOccurrences(p).filter(
      (o) => o.visible && !o.locked,
    ),
    ref = editor.topologySelection;
  let path = state.path;
  try {
    definitionAtPath(p, path);
  } catch {
    path = [];
  }
  const frame = precisionFrame(p, { ...state, path });
  const target = state.target
    ? transformAffine(
        state.target,
        inverseAffine(frameMatrix(state.system, frame.matrix, frame.plane)),
      )
    : null;
  const vertex =
    ref?.kind === "vertex" &&
    occurrences.some(
      (o) => JSON.stringify(o.path) === JSON.stringify(ref.occurrencePath),
    ) &&
    JSON.stringify(ref.occurrencePath) === JSON.stringify(state.path)
      ? ref
      : null;
  const sharedCount = vertex
    ? definitionOccurrences(p).filter(
        (o) => o.definitionId === vertex.definitionId,
      ).length
    : 0;
  const begin = () => {
    state.configure({
      enabled: !state.enabled,
      path: ref?.occurrencePath ?? [],
      axis: null,
    });
    if (!state.enabled) {
      editor.setTool("select");
      useEditor.setState({ snap: true });
      if (ref?.kind === "vertex")
        state.setAnchor(
          transformAffine(
            p.geometries[ref.geometryId].vertices[ref.entityId].position,
            occurrenceMatrix(p, ref.occurrencePath),
          ),
        );
    }
  };
  return (
    <div className="precision-panel" data-testid="precision-panel">
      <button onClick={begin} aria-pressed={state.enabled} title="Точная точка">
        {state.enabled ? "Закрыть точный ввод" : "Точная точка"}
      </button>
      {state.enabled && (
        <div className="precision-fields">
          <strong>Точка построения</strong>
          <label>
            Контекст{" "}
            <select
              aria-label="Контекст точного ввода"
              value={JSON.stringify(state.path)}
              onChange={(e) =>
                state.configure({ path: JSON.parse(e.target.value) })
              }
            >
              {occurrences.map((o) => (
                <option
                  key={JSON.stringify(o.path)}
                  value={JSON.stringify(o.path)}
                >
                  {o.path.length ? o.path.join(" / ") : "Мировая сцена"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Координаты{" "}
            <select
              aria-label="Система координат"
              value={state.system}
              onChange={(e) =>
                state.configure({ system: e.target.value as CoordinateSystem })
              }
            >
              <option value="world">Мировые</option>
              <option value="local">Локальные</option>
              <option value="plane">Рабочей плоскости</option>
            </select>
          </label>
          <label>
            Плоскость{" "}
            <select
              aria-label="Рабочая плоскость"
              value={state.planeName}
              onChange={(e) =>
                state.configure({ planeName: e.target.value as PlaneName })
              }
            >
              {["XY", "XZ", "YZ"].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          {ref?.kind === "face" && (
            <button
              onClick={() =>
                state.configure({
                  planeOverride: affinePlane(
                    p.geometries[ref.geometryId].faces[ref.entityId].plane,
                    occurrenceMatrix(p, ref.occurrencePath),
                  ),
                })
              }
            >
              Плоскость выбранной грани
            </button>
          )}
          {state.planeOverride && (
            <small>Рабочая плоскость по выбранной грани</small>
          )}
          <label>
            Ось{" "}
            <select
              aria-label="Фиксация оси"
              value={state.axis ?? "free"}
              onChange={(e) =>
                state.configure({
                  axis:
                    e.target.value === "free"
                      ? null
                      : (e.target.value as "X" | "Y" | "Z"),
                })
              }
            >
              <option value="free">Свободно</option>
              {["X", "Y", "Z"].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={editor.snap}
              onChange={(e) => useEditor.setState({ snap: e.target.checked })}
            />
            Привязки
          </label>
          <label>
            <input
              type="checkbox"
              checked={state.contextOnly}
              onChange={(e) =>
                state.configure({ contextOnly: e.target.checked })
              }
            />
            Только активный контекст
          </label>
          <label>
            Шаг сетки{" "}
            <select
              aria-label="Шаг точной сетки"
              value={state.gridStep}
              onChange={(e) =>
                state.configure({ gridStep: Number(e.target.value) })
              }
            >
              {[0.001, 0.01, 0.1, 0.25, 1].map((n) => (
                <option key={n} value={n}>
                  {formatDimension(n, p.units)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Ввод{" "}
            <select
              aria-label="Вид точного ввода"
              value={mode}
              onChange={(e) => {
                setMode(e.target.value as PrecisionInput["mode"]);
                state.clear();
              }}
            >
              <option value="coordinates">X; Y; Z</option>
              <option value="length">Длина</option>
              <option value="rectangle">Ширина; высота</option>
            </select>
          </label>
          {mode === "coordinates" && (
            <label>
              <input
                type="checkbox"
                checked={relative}
                onChange={(e) => setRelative(e.target.checked)}
              />
              Относительно начала
            </label>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              state.submit(p, text, mode, relative);
            }}
          >
            <input
              aria-label="Точный размер"
              placeholder={
                mode === "coordinates"
                  ? "1,5 м; 0; 2 м"
                  : mode === "rectangle"
                    ? "4 м; 3 м"
                    : "2500 мм"
              }
              value={text}
              aria-invalid={!!state.error}
              onFocus={() => usePrecision.setState({ editing: true })}
              onBlur={() => usePrecision.setState({ editing: false })}
              onChange={(e) => {
                setText(e.target.value);
                usePrecision.setState({ error: "" });
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  state.clear();
                  e.currentTarget.blur();
                }
              }}
            />
            <button type="submit">Принять ввод</button>
          </form>
          {state.error && (
            <div role="alert" className="precision-error">
              {state.error}
            </div>
          )}
          {state.warning && <small role="status">{state.warning}</small>}
          <output
            data-testid="precision-target"
            data-world={state.target ? JSON.stringify(state.target) : ""}
          >
            {target
              ? target.map((n) => formatDimension(n, p.units)).join("; ")
              : "Наведите курсор на сцену"}
          </output>
          <small>
            {state.exact
              ? "Точный ввод · без округления сеткой"
              : (state.hover?.label ?? `Плоскость ${state.planeName}`)}
          </small>
          {state.rectangle && (
            <small>
              Прямоугольник {formatDimension(state.rectangle.width, p.units)} ×{" "}
              {formatDimension(state.rectangle.height, p.units)}
            </small>
          )}
          <button
            disabled={!state.target}
            onClick={() => {
              if (state.target) state.setAnchor(state.target);
            }}
          >
            Использовать как начало
          </button>
          <button onClick={() => state.clear()}>Сбросить точку</button>
          {vertex && sharedCount > 1 && (
            <label>
              <input
                type="checkbox"
                checked={sharedConfirmed}
                onChange={(e) => setSharedConfirmed(e.target.checked)}
              />
              Изменить все {sharedCount} экземпляра общего компонента
            </label>
          )}
          {vertex && (
            <button
              disabled={
                busy ||
                !state.target ||
                isGeometryLocked(p, vertex) ||
                (sharedCount > 1 && !sharedConfirmed)
              }
              onClick={async () => {
                if (!state.target) return;
                setBusy(true);
                const request = usePrecision.getState();
                const result = await editor.editGeometry(
                  vertex,
                  {
                    kind: "move-vertices",
                    positions: [
                      {
                        vertexId: id(vertex.entityId),
                        position: localPrecisionPoint(
                          p,
                          vertex.occurrencePath,
                          state.target,
                        ),
                      },
                    ],
                  },
                  () => {
                    const current = usePrecision.getState();
                    return (
                      current.enabled &&
                      current.path === request.path &&
                      current.target === request.target &&
                      current.system === request.system &&
                      useEditor.getState().topologySelection === vertex
                    );
                  },
                );
                setBusy(false);
                if (result.status === "rejected")
                  usePrecision.setState({ error: result.error });
                else state.clear();
              }}
            >
              Переместить выбранную вершину
            </button>
          )}
          <small>
            ЛКМ — зафиксировать точку. СКМ/ПКМ — камера. Escape — сброс. Размеры
            — в {p.units}; суффикс меняет единицу.
          </small>
        </div>
      )}
    </div>
  );
}
