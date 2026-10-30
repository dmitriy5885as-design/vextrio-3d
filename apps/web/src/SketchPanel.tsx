import { useEffect, useRef, useState } from "react";
import {
  useEditor,
  usePrecision,
  useSketch,
  sketchController,
  sketchPlane,
  precisionFrame,
} from "@forma/editor";
import { definitionOccurrences, definitionAtPath } from "@forma/document";
import {
  formatDimension,
  resolvePrecision,
  type PrecisionInput,
  type PlaneName,
  type CoordinateSystem,
} from "@forma/snapping";
import { subtract, length, multiply, dot } from "@forma/geometry";
import "./sketch.css";
export function SketchPanel() {
  const editor = useEditor(),
    precision = usePrecision(),
    state = useSketch(),
    [text, setText] = useState(""),
    [coordinates, setCoordinates] = useState(false),
    input = useRef<HTMLInputElement>(null);
  const p = editor.project;
  useEffect(() => {
    setText("");
    setCoordinates(false);
  }, [state.tool]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        !state.tool ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        e.repeat ||
        (e.target as HTMLElement).matches("input,select,textarea,button")
      )
        return;
      if (/^[0-9@=.,+\-]$/.test(e.key)) {
        e.preventDefault();
        setText(e.key);
        input.current?.focus();
      }
      if (e.key === "Enter" && precision.target) {
        e.preventDefault();
        void sketchController.click(
          precision.target,
          sketchPlane(),
          "enter/" + e.timeStamp,
        );
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [state.tool, precision.target]);
  if (p.schemaVersion !== 2 || !state.tool) return null;
  const occurrences = definitionOccurrences(p).filter(
      (o) => o.visible && !o.locked,
    ),
    definitionId = definitionAtPath(p, precision.path),
    count = occurrences.filter((o) => o.definitionId === definitionId).length;
  const mode: PrecisionInput["mode"] = coordinates
    ? "coordinates"
    : state.tool === "line" || state.tool === "circle"
      ? "length"
      : "rectangle";
  const submit = async () => {
    try {
      const frame = precisionFrame(p, precision),
        plane = sketchPlane();
      if (state.tool === "circle" && /^\d+s$/i.test(text.trim())) {
        const count = Number(text.trim().slice(0, -1));
        const accepted = sketchController.setCircleSides(count, plane);
        if (accepted) {
          setText("");
          usePrecision.setState({ editing: false, exact: false, error: "" });
          input.current?.blur();
        }
        return;
      }
      if (!state.start && mode !== "coordinates")
        throw Error(
          "Сначала задайте начальную точку щелчком или координатами.",
        );
      let direction =
        (precision.target ?? state.target)
          ? subtract(
              (precision.target ?? state.target)!,
              state.start ?? precision.anchor,
            )
          : ([0, 0, 0] as [number, number, number]);
      if (state.tool === "circle") {
        direction = subtract(
          direction,
          multiply(plane.normal, dot(direction, plane.normal)),
        );
        if (length(direction) <= 1e-7) direction = plane.u;
      }
      const result = resolvePrecision({
        text,
        mode,
        relative: false,
        unit: p.units,
        anchor: state.start ?? precision.anchor,
        direction,
        matrix: frame.matrix,
        plane,
        system: precision.system,
        axis: precision.axis,
      });
      if (
        state.tool === "circle" &&
        state.start &&
        length(subtract(result.point, state.start)) <= 1e-7
      )
        throw Error("Радиус должен быть больше геометрического допуска.");
      if (
        state.tool === "circle" &&
        state.start &&
        Math.abs(dot(subtract(result.point, state.start), plane.normal)) > 1e-7
      )
        throw Error(
          "Радиус должен лежать в рабочей плоскости. Снимите фиксацию другой оси.",
        );
      usePrecision.setState({
        target: result.point,
        rectangle: result.rectangle ?? null,
        exact: true,
        error: "",
        editing: false,
      });
      sketchController.move(result.point, plane);
      await sketchController.click(
        result.point,
        plane,
        "numeric/" + performance.now(),
      );
      if (!sketchController.state.error) {
        setText("");
        input.current?.blur();
      }
    } catch (e) {
      usePrecision.setState({
        error: e instanceof Error ? e.message : "Ошибка ввода",
      });
    }
  };
  const error = precision.error || state.error;
  return (
    <div
      className="sketch-panel"
      data-testid="sketch-panel"
      data-tool={state.tool}
      data-phase={state.phase}
    >
      <div className="sketch-title">
        <strong>
          {state.tool === "line"
            ? "Линия · L"
            : state.tool === "circle"
              ? "Окружность · C"
              : "Прямоугольник · R"}
        </strong>
        <button
          title="Завершить рисование"
          onClick={() => editor.setTool("select")}
        >
          Готово · Space
        </button>
      </div>
      <p>
        {state.phase === "Commit"
          ? "Строим геометрию…"
          : state.start
            ? state.tool === "line"
              ? "Укажите конец отрезка"
              : state.tool === "circle"
                ? "Укажите радиус или введите размер"
                : "Укажите противоположный угол"
            : state.tool === "circle"
              ? "Щёлкните центр окружности"
              : "Щёлкните начальную точку"}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (state.phase !== "Commit") void submit();
        }}
      >
        <label>
          <span>
            {mode === "coordinates"
              ? "X; Y; Z"
              : mode === "length"
                ? state.tool === "circle"
                  ? "Радиус"
                  : "Длина"
                : "Ширина; высота"}
          </span>
          <input
            ref={input}
            aria-label="Размер построения"
            value={text}
            placeholder={
              mode === "coordinates"
                ? "=0;0;0"
                : mode === "length"
                  ? state.tool === "circle"
                    ? "1000 мм · 48s — сегменты"
                    : "4000 мм"
                  : "4000 мм;3000 мм"
            }
            aria-invalid={!!error}
            disabled={state.phase === "Commit"}
            onFocus={() => usePrecision.setState({ editing: true })}
            onBlur={() => usePrecision.setState({ editing: false })}
            onChange={(e) => {
              setText(e.target.value);
              usePrecision.setState({ error: "" });
            }}
            onKeyDown={(e) => {
              if (e.repeat && e.key === "Enter") e.preventDefault();
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                sketchController.cancel();
                usePrecision.getState().clear();
                setText("");
                e.currentTarget.blur();
              }
            }}
          />
        </label>
        <button type="submit" disabled={state.phase === "Commit"}>
          Enter · подтвердить
        </button>
      </form>
      {state.tool === "circle" && (
        <label>
          Сегментов{" "}
          <select
            aria-label="Сегменты окружности"
            value={state.circleSides}
            disabled={state.phase === "Commit"}
            onChange={(e) =>
              sketchController.setCircleSides(
                Number(e.target.value),
                sketchPlane(),
              )
            }
          >
            {[
              ...new Set([
                3,
                4,
                6,
                8,
                12,
                16,
                24,
                32,
                48,
                64,
                96,
                128,
                state.circleSides,
              ]),
            ]
              .sort((a, b) => a - b)
              .map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
          </select>
        </label>
      )}
      <label className="sketch-toggle">
        <input
          type="checkbox"
          aria-label="Ввод координат построения"
          checked={coordinates}
          onChange={(e) => {
            setCoordinates(e.target.checked);
            setText("");
            usePrecision.setState({ error: "" });
          }}
        />
        Координаты вместо размеров
      </label>
      {precision.target && (
        <output data-testid="drawing-target">
          {precision.target.map((n) => formatDimension(n, p.units)).join("; ")}
          {state.start && (state.tool === "line" || state.tool === "circle")
            ? ` · ${state.tool === "circle" ? "R " : ""}${formatDimension(length(subtract(precision.target, state.start)), p.units)}`
            : ""}
        </output>
      )}
      <small>
        {precision.hover?.label ?? `Плоскость ${precision.planeName}`} · Esc —
        отменить · Space — выбор
      </small>
      {state.preview === "pending" && (
        <small>Проверяем пересечения и грани…</small>
      )}
      {state.preview === "valid" && state.stats && (
        <small data-testid="sketch-preview-stats">
          Геометрия проверена · граней: {state.stats.faces}
        </small>
      )}
      {error && (
        <p role="alert" className="sketch-error">
          {error}
        </p>
      )}
      {precision.warning && <p role="status">{precision.warning}</p>}
      <details>
        <summary>Плоскость и контекст</summary>
        <label>
          Контекст{" "}
          <select
            aria-label="Контекст рисования"
            value={JSON.stringify(precision.path)}
            onChange={(e) =>
              usePrecision
                .getState()
                .configure({ path: JSON.parse(e.target.value) })
            }
          >
            {occurrences.map((o) => (
              <option
                key={JSON.stringify(o.path)}
                value={JSON.stringify(o.path)}
              >
                {o.path.length ? o.path.join(" / ") : "Сцена"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Координаты{" "}
          <select
            aria-label="Координаты рисования"
            value={precision.system}
            onChange={(e) =>
              precision.configure({
                system: e.target.value as CoordinateSystem,
              })
            }
          >
            <option value="world">Мировые</option>
            <option value="local">Локальные</option>
            <option value="plane">Плоскости</option>
          </select>
        </label>
        <label>
          Плоскость{" "}
          <select
            aria-label="Плоскость рисования"
            value={precision.planeName}
            onChange={(e) =>
              precision.configure({ planeName: e.target.value as PlaneName })
            }
          >
            {["XZ", "XY", "YZ"].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <label>
          Ось{" "}
          <select
            aria-label="Ось рисования"
            value={precision.axis ?? "free"}
            onChange={(e) =>
              precision.configure({
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
            checked={precision.contextOnly}
            onChange={(e) =>
              precision.configure({ contextOnly: e.target.checked })
            }
          />
          Привязки только в контексте
        </label>
      </details>
      {count > 1 && (
        <label>
          <input
            type="checkbox"
            checked={precision.sharedEditConfirmed}
            onChange={(e) =>
              usePrecision.setState({ sharedEditConfirmed: e.target.checked })
            }
          />
          Изменить все {count} экземпляра общего компонента
        </label>
      )}
    </div>
  );
}
