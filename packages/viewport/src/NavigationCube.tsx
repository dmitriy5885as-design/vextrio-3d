import { useRef } from "react";
import { Vector3, Matrix4, Spherical } from "three";
import { useEditor } from "@forma/editor";
import type { Vec3 } from "@forma/shared";
const views = [
  { key: "front", label: "Вид спереди", text: "СПЕРЕДИ", normal: [0, 0, 1] },
  { key: "back", label: "Вид сзади", text: "СЗАДИ", normal: [0, 0, -1] },
  { key: "right", label: "Вид справа", text: "СПРАВА", normal: [1, 0, 0] },
  { key: "left", label: "Вид слева", text: "СЛЕВА", normal: [-1, 0, 0] },
  { key: "top", label: "Вид сверху", text: "СВЕРХУ", normal: [0, 1, 0] },
  { key: "bottom", label: "Вид снизу", text: "СНИЗУ", normal: [0, -1, 0] },
] as const;
export function NavigationCube() {
  const camera = useEditor((s) => s.project.camera),
    drag = useRef<{
      x: number;
      y: number;
      direction: Vector3;
      moved: boolean;
      id: number;
    } | null>(null),
    suppress = useRef(false);
  const direction = new Vector3(...camera.position).sub(
    new Vector3(...camera.target),
  );
  if (direction.lengthSq() < 1e-12) direction.set(1, 1, 1);
  const forward = direction.clone().normalize(),
    matrix = new Matrix4()
      .lookAt(direction, new Vector3(), new Vector3(0, 1, 0))
      .invert();
  const project = (v: readonly number[], cx = 78, cy = 64, scale = 25) => {
    const p = new Vector3(v[0], v[1], v[2]).applyMatrix4(matrix);
    return { x: cx + p.x * scale, y: cy - p.y * scale, z: p.z };
  };
  const faces = views
    .map((view) => {
      const n = new Vector3(...view.normal),
        t = Math.abs(n.y) > 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0),
        u = t.clone().cross(n),
        v = n.clone().cross(u),
        points = [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ].map(([a, b]) =>
          project(
            n.clone().addScaledVector(u, a).addScaledVector(v, b).toArray(),
          ),
        ),
        center = project(view.normal);
      return {
        ...view,
        points,
        center,
        visible: n.dot(forward) > 1e-5,
        active: n.dot(forward) > 0.999,
      };
    })
    .filter((f) => f.visible)
    .sort((a, b) => a.center.z - b.center.z);
  const corners = [-1, 1]
    .flatMap((x) =>
      [-1, 1].flatMap((y) => [-1, 1].map((z) => [x, y, z] as Vec3)),
    )
    .filter((v) => v.some((n, i) => n * forward.getComponent(i) > 1e-6));
  const edges = [0, 1, 2]
    .flatMap((axis) =>
      [-1, 1].flatMap((a) =>
        [-1, 1].map((b) => {
          const center: Vec3 = [0, 0, 0],
            other = [0, 1, 2].filter((i) => i !== axis);
          center[other[0]] = a;
          center[other[1]] = b;
          const start = [...center],
            end = [...center];
          start[axis] = -1;
          end[axis] = 1;
          return { center, start, end };
        }),
      ),
    )
    .filter((e) => e.center.some((n, i) => n * forward.getComponent(i) > 1e-6));
  const activate = (fn: () => void) => {
    if (!suppress.current) fn();
  };
  return (
    <div
      className="navigation-cube"
      aria-label="Ориентация камеры"
      data-testid="navigation-cube"
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") e.stopPropagation();
      }}
    >
      <div className="navigation-heading">
        <span>ОРИЕНТАЦИЯ</span>
        <button
          title="Изометрия"
          aria-label="Изометрия ↗"
          onClick={() => useEditor.getState().view("iso")}
        >
          ⌂
        </button>
      </div>
      <svg
        viewBox="0 0 156 137"
        aria-label="Ориентационный куб: потяните для вращения"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          suppress.current = false;
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            direction: direction.clone(),
            moved: false,
            id: e.pointerId,
          };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          const dx = e.clientX - d.x,
            dy = e.clientY - d.y;
          if (Math.hypot(dx, dy) < 4 && !d.moved) return;
          d.moved = true;
          if (!e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.setPointerCapture(e.pointerId);
          suppress.current = true;
          const sphere = new Spherical().setFromVector3(d.direction);
          sphere.theta -= dx * 0.012;
          sphere.phi = Math.max(
            0.002,
            Math.min(Math.PI - 0.002, sphere.phi + dy * 0.012),
          );
          useEditor
            .getState()
            .navigateCamera(
              new Vector3().setFromSpherical(sphere).toArray() as Vec3,
            );
        }}
        onPointerUp={(e) => {
          drag.current = null;
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
          suppress.current = true;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
        onClickCapture={(e) => {
          if (suppress.current) {
            e.stopPropagation();
            e.preventDefault();
            suppress.current = false;
          }
        }}
      >
        <ellipse cx="78" cy="105" rx="44" ry="7" className="cube-shadow" />
        {faces.map((f) => (
          <g
            key={f.key}
            role="button"
            tabIndex={0}
            aria-label={f.label}
            aria-pressed={f.active}
            className={`cube-face${f.active ? " cube-active" : ""}`}
            onClick={() => activate(() => useEditor.getState().view(f.key))}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                useEditor.getState().view(f.key);
              }
            }}
          >
            <title>{f.label}</title>
            <polygon points={f.points.map((p) => `${p.x},${p.y}`).join(" ")} />
            <text x={f.center.x} y={f.center.y + 2.5}>
              {f.text}
            </text>
          </g>
        ))}
        {edges.map((e) => {
          const a = project(e.start),
            b = project(e.end);
          return (
            <line
              key={e.center.join()}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className="cube-edge"
              role="button"
              tabIndex={0}
              aria-label={`Вид по ребру ${e.center.join(",")}`}
              onClick={() =>
                activate(() => useEditor.getState().navigateCamera(e.center))
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  useEditor.getState().navigateCamera(e.center);
                }
              }}
            >
              <title>Вид по ребру</title>
            </line>
          );
        })}
        {corners.map((v) => {
          const p = project(v);
          return (
            <circle
              key={v.join()}
              cx={p.x}
              cy={p.y}
              r="4.5"
              className="cube-corner"
              role="button"
              tabIndex={0}
              aria-label={`Угловой вид ${v.join(",")}`}
              onClick={() =>
                activate(() => useEditor.getState().navigateCamera(v))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  useEditor.getState().navigateCamera(v);
                }
              }}
            >
              <title>Угловой вид</title>
            </circle>
          );
        })}
        {(
          [
            [[1, 0, 0], "X", "#fa7b7b"],
            [[0, 1, 0], "Y", "#59dbc4"],
            [[0, 0, 1], "Z", "#65a8ff"],
          ] as const
        ).map(([axis, label, color]) => {
          const p = project(axis, 26, 119, 17);
          return (
            <g key={label} className="cube-axis">
              <line x1="26" y1="119" x2={p.x} y2={p.y} stroke={color} />
              <text x={p.x + (p.x < 26 ? -7 : 4)} y={p.y + 3} fill={color}>
                {label}
              </text>
            </g>
          );
        })}
        <text x="104" y="128" className="cube-drag-hint">
          Потяните ↔
        </text>
      </svg>
      <div className="navigation-actions">
        <select
          aria-label="Стандартный вид"
          value=""
          onChange={(e) => useEditor.getState().view(e.target.value)}
        >
          <option value="" disabled>
            Выбрать вид…
          </option>
          {views.map((v) => (
            <option key={v.key} value={v.key}>
              {v.label}
            </option>
          ))}
        </select>
        <button
          aria-label="Тип проекции"
          title="Переключить перспективную и ортографическую проекцию"
          onClick={() => useEditor.getState().view("projection")}
        >
          {camera.projection === "orthographic" ? "Орто" : "Персп"}
        </button>
      </div>
    </div>
  );
}
