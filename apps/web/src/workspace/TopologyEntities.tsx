import { useState } from "react";
import { useEditor, usePrecision } from "@forma/editor";
import type { GeometryModel } from "@forma/geometry";
export function TopologyEntities({
  model,
  definitionId,
  path,
  onSelect,
}: {
  model: GeometryModel;
  definitionId: string;
  path: string[];
  onSelect?: () => void;
}) {
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const s = useEditor();
  return (
    <div className="topology-entities">
      {(
        [
          ["face", "faces", "Грани"],
          ["edge", "edges", "Рёбра / отрезки"],
          ["vertex", "vertices", "Вершины"],
        ] as const
      ).map(([kind, table, title]) => {
        const entities = Object.keys(model[table]),
          limit = limits[kind] ?? 40;
        return (
          <details
            key={kind}
            onToggle={(e) => {
              const value = e.currentTarget.open;
              setOpened((old) =>
                old[kind] === value ? old : { ...old, [kind]: value },
              );
            }}
          >
            <summary>
              {title} · {entities.length}
            </summary>
            {opened[kind] &&
              entities.slice(0, limit).map((entityId, i) => (
                <button
                  key={entityId}
                  aria-label={`${kind === "face" ? "Грань" : kind === "edge" ? "Ребро" : "Вершина"} ${i + 1}`}
                  className={
                    s.topologySelections.some(
                      (r) =>
                        r.entityId === entityId &&
                        JSON.stringify(r.occurrencePath) ===
                          JSON.stringify(path),
                    )
                      ? "active"
                      : ""
                  }
                  title={`${title} ${i + 1} — ${entityId}`}
                  onClick={(e) => {
                    usePrecision.getState().configure({ path });
                    s.selectEntity(
                      {
                        definitionId,
                        geometryId: model.id,
                        kind,
                        entityId,
                        occurrencePath: path,
                      },
                      e.shiftKey,
                    );
                    onSelect?.();
                  }}
                >
                  <span>
                    {kind === "face" ? "▱" : kind === "edge" ? "╱" : "•"}{" "}
                    {kind === "face"
                      ? "Грань"
                      : kind === "edge"
                        ? "Ребро"
                        : "Вершина"}{" "}
                    {i + 1}
                  </span>
                  <small>{entityId.split("/").slice(-2).join("/")}</small>
                </button>
              ))}
            {opened[kind] && entities.length > limit && (
              <button
                onClick={() => setLimits({ ...limits, [kind]: limit + 40 })}
              >
                Показать ещё 40
              </button>
            )}
          </details>
        );
      })}
      <small>Дуги и окружности представлены цепочками рёбер.</small>
    </div>
  );
}
