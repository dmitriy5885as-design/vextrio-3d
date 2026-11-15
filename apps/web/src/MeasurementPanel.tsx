import { useEffect, useRef, useState } from "react";
import { useEditor, usePrecision } from "@forma/editor";
import {
  constructionData,
  definitionAtPath,
  occurrenceMatrix,
  measurement,
} from "@forma/document";
import {
  inverseAffine,
  transformAffine,
  add,
  subtract,
  length,
  multiply,
  dot,
} from "@forma/geometry";
import { parseDimension, formatDimension } from "@forma/snapping";
import type { Vec3 } from "@forma/shared";

export function MeasurementPanel() {
  const editor = useEditor(),
    precision = usePrecision();
  const [open, setOpen] = useState(false),
    [values, setValues] = useState(["0; 0; 0", "4; 0; 0", "0; 0; 3"]);
  const [error, setError] = useState(""),
    [angleText, setAngleText] = useState("45");
  const p = editor.project;
  const previousUnit = useRef(p.units);
  useEffect(() => {
    const oldUnit = previousUnit.current;
    previousUnit.current = p.units;
    if (oldUnit === p.units) return;
    setValues((old) =>
      old.map((text) => {
        try {
          const parts = text.split(";");
          if (parts.length !== 3) return text;
          return parts
            .map((part) =>
              formatDimension(
                parseDimension(part.trim(), oldUnit, true),
                p.units,
              ),
            )
            .join("; ");
        } catch {
          return text;
        }
      }),
    );
  }, [p.units]);
  if (p.schemaVersion !== 2) return null;
  const path = precision.path;
  let did: string;
  try {
    did = definitionAtPath(p, path);
  } catch {
    return null;
  }
  const parse = (text: string): Vec3 => {
    const parts = text.split(";");
    if (parts.length !== 3)
      throw Error("Введите X; Y; Z через точку с запятой.");
    return parts.map((x) => parseDimension(x.trim(), p.units, true)) as Vec3;
  };
  let result: ReturnType<typeof measurement> | undefined;
  try {
    result = measurement(parse(values[0]), parse(values[1]), parse(values[2]));
  } catch {
    /* Show on action. */
  }
  const update = (i: number, text: string) =>
    setValues((old) => old.map((v, j) => (i === j ? text : v)));
  const capture = (i: number) => {
    const ref = editor.topologySelection;
    let point = precision.target;
    if (ref?.kind === "vertex") {
      const vertex = p.geometries[ref.geometryId]?.vertices[ref.entityId];
      if (vertex)
        point = transformAffine(
          vertex.position,
          occurrenceMatrix(p, ref.occurrencePath),
        );
    }
    if (!point) {
      setError("Выберите вершину или точную точку в сцене.");
      return;
    }
    update(i, point.map((x) => formatDimension(x, p.units)).join("; "));
    setError("");
  };
  const create = (line: boolean) => {
    try {
      const a = parse(values[0]),
        b = parse(values[1]);
      const matrix = inverseAffine(occurrenceMatrix(p, path));
      const origin = transformAffine(a, matrix);
      let direction: Vec3 | undefined;
      if (line) {
        const vector = subtract(
          transformAffine(add(a, measurement(a, b).direction), matrix),
          origin,
        );
        direction = multiply(vector, 1 / length(vector));
      }
      const r = editor.addGuide(path, origin, direction);
      if (r.status === "rejected") throw Error(r.error);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const createAngle = () => {
    try {
      const a = parse(values[0]),
        b = parse(values[1]),
        c = parse(values[2]);
      const angle = Number(angleText.trim().replace(",", "."));
      if (!angleText.trim() || !Number.isFinite(angle) || Math.abs(angle) > 360)
        throw Error("Угол должен быть от −360 до 360°.");
      const u = measurement(a, b).direction;
      const ac = subtract(c, a),
        perpendicular = subtract(ac, multiply(u, dot(ac, u)));
      if (length(perpendicular) <= 1e-9)
        throw Error("Точка C должна задавать плоскость угла вне прямой AB.");
      const v = multiply(perpendicular, 1 / length(perpendicular)),
        radians = (angle * Math.PI) / 180;
      const direction = add(
        multiply(u, Math.cos(radians)),
        multiply(v, Math.sin(radians)),
      );
      const matrix = inverseAffine(occurrenceMatrix(p, path)),
        origin = transformAffine(a, matrix);
      const local = subtract(
        transformAffine(add(a, direction), matrix),
        origin,
      );
      const r = editor.addGuide(
        path,
        origin,
        multiply(local, 1 / length(local)),
      );
      if (r.status === "rejected") throw Error(r.error);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const guides = Object.values(constructionData(p).guides).filter(
    (g) => g.definitionId === did,
  );
  return (
    <div className="measurement-panel" data-testid="measurement-panel">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title="Измерить расстояние и угол, создать вспомогательные направляющие"
      >
        Измерения и направляющие
      </button>
      {open && (
        <div className="precision-fields">
          <strong>Рулетка и измерение угла</strong>
          <small>
            Мировые координаты X; Y; Z. Единицы: {p.units}. Для угла: вершина A,
            лучи AB и AC.
          </small>
          {values.map((value, i) => (
            <div key={i}>
              <label>
                Точка {String.fromCharCode(65 + i)}
                <input
                  aria-label={`Измерение: точка ${String.fromCharCode(65 + i)}`}
                  value={value}
                  onChange={(e) => update(i, e.target.value)}
                />
              </label>
              <button onClick={() => capture(i)}>
                Взять {String.fromCharCode(65 + i)} из выделения
              </button>
            </div>
          ))}
          <output aria-label="Измеренное расстояние">
            {result
              ? formatDimension(result.distance, p.units)
              : "Некорректные точки"}
          </output>
          <output aria-label="Измеренный угол">
            {result?.angle !== undefined
              ? `${((result.angle * 180) / Math.PI).toFixed(4)}°`
              : "—"}
          </output>
          <button onClick={() => create(false)}>
            Создать направляющую точку A
          </button>
          <button onClick={() => create(true)}>Создать направляющую AB</button>
          <label>
            Угол направляющей, °
            <input
              aria-label="Угол направляющей"
              value={angleText}
              onChange={(e) => setAngleText(e.target.value)}
            />
          </label>
          <button onClick={createAngle}>Создать направляющую под углом</button>
          <small>
            Направляющие не создают грани. Контекст: {p.definitions[did].name}
          </small>
          <ul aria-label="Направляющие контекста">
            {guides.map((g) => (
              <li key={g.id}>
                {g.kind === "line" ? "Прямая" : "Точка"}{" "}
                <button
                  aria-label={`Удалить направляющую ${g.id}`}
                  onClick={() => {
                    const r = editor.removeGuides(path, [g.id]);
                    setError(r.status === "rejected" ? r.error : "");
                  }}
                >
                  Удалить
                </button>
              </li>
            ))}
          </ul>
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
