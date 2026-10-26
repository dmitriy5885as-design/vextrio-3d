import {
  getLegacyObjects,
  occurrenceMatrix,
  definitionOccurrences,
} from "@forma/document";
import { tessellateFace, tessellationArea, bodyVolume } from "@forma/geometry";
import { isGeometryLocked } from "@forma/editor";
import { useEffect, useState } from "react";
import { useEditor, isObjectLocked } from "@forma/editor";
import { ru } from "@forma/ui";
import { primitiveNames, type SceneObject } from "@forma/shared";
import { ChevronDown, Box, Copy, Trash2 } from "lucide-react";
function NumberField({
  value,
  label,
  disabled,
  onCommit,
}: {
  value: number;
  label: string;
  disabled: boolean;
  onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(Number(value.toFixed(4))));
  useEffect(() => setDraft(String(Number(value.toFixed(4)))), [value]);
  return (
    <label className="axis-input">
      <span>{label.split(" ").at(-1)}</span>
      <input
        aria-label={label}
        type="number"
        step="0.1"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = Number(draft);
          if (draft !== "" && Number.isFinite(n) && Math.abs(n) < 1e7)
            onCommit(n);
          else setDraft(String(value));
          setDraft(String(Number(value.toFixed(4))));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </label>
  );
}
export function Properties() {
  const s = useEditor();
  const o = getLegacyObjects(s.project).find((o) => o.id === s.selected);
  const objectLocked = o ? isObjectLocked(s.project, o.id) : false;
  const ancestorLocked = o ? isObjectLocked(s.project, o.id, true) : false;
  const factor =
    s.project.units === "mm" ? 1000 : s.project.units === "cm" ? 100 : 1;
  const ref = s.topologySelection;
  const [paintShared, setPaintShared] = useState(false);
  useEffect(
    () => setPaintShared(false),
    [ref?.entityId, JSON.stringify(ref?.occurrencePath)],
  );
  const sharedFace =
    s.project.schemaVersion === 2 && ref
      ? definitionOccurrences(s.project).filter(
          (o) => o.definitionId === ref.definitionId,
        ).length > 1
      : false;
  if (s.project.schemaVersion === 2 && ref) {
    const m = s.project.geometries[ref.geometryId],
      name = {
        vertex: "Вершина",
        edge: "Ребро",
        face: "Грань",
        coedge: "Обход ребра",
        loop: "Контур",
        shell: "Оболочка",
        body: "Тело",
      }[ref.kind],
      face = ref.kind === "face" ? m.faces[ref.entityId] : null,
      edge = ref.kind === "edge" ? m.edges[ref.entityId] : null,
      vertex = ref.kind === "vertex" ? m.vertices[ref.entityId] : null;
    return (
      <aside
        className="properties"
        data-testid="topology-selection"
        data-kind={ref.kind}
        data-entity-id={ref.entityId}
      >
        <div className="panel-heading">
          Свойства <span className="micro">ТОПОЛОГИЯ</span>
        </div>
        <div className="property-group">
          <h3>{name}</h3>
          {s.topologySelections.length > 1 && (
            <p>
              Выбрано {s.topologySelections.length} · свойства последнего
              элемента
            </p>
          )}
          <p>Определение: {s.project.definitions[ref.definitionId].name}</p>
          <p>
            ID: <code>{ref.entityId}</code>
          </p>
          <p>
            Геометрия: <code>{ref.geometryId}</code>
          </p>
          <p>Экземпляр: {ref.occurrencePath.join(" / ") || "Сцена"}</p>
          {face && (
            <p data-testid="face-area">
              Площадь: {Number(tessellateFace(m, face).area.toFixed(8))} м² (в
              определении)
            </p>
          )}
          {face &&
            (() => {
              const body = Object.values(m.bodies).find((b) =>
                  b.faceIds.includes(face.id),
                ),
                volume = body
                  ? bodyVolume(
                      m,
                      body.id,
                      occurrenceMatrix(
                        s.project as import("@forma/document").ProjectV2,
                        ref.occurrencePath,
                      ),
                    )
                  : null;
              return volume === null ? null : (
                <p data-testid="body-volume">
                  Объём тела: {Number(volume.toFixed(8))} м³
                </p>
              );
            })()}
          {edge && (
            <p>
              Вершины: {edge.start} → {edge.end}
            </p>
          )}
          {face && ref.occurrencePath.length > 0 && (
            <p data-testid="face-world-area">
              Площадь экземпляра:{" "}
              {Number(
                tessellationArea(
                  tessellateFace(m, face),
                  occurrenceMatrix(s.project, ref.occurrencePath),
                ).toFixed(8),
              )}{" "}
              м²
            </p>
          )}
          {vertex && <p>Координаты: {vertex.position.join(", ")} м</p>}
          {face && sharedFace && (
            <label className="property-row">
              <input
                type="checkbox"
                checked={paintShared}
                onChange={(e) => setPaintShared(e.target.checked)}
              />
              Окрасить все связанные экземпляры
            </label>
          )}
          {face && (
            <label className="property-row">
              Цвет грани
              <input
                type="color"
                aria-label="Цвет выбранной грани"
                value={s.project.materials[face.frontMaterialId].color}
                disabled={
                  isGeometryLocked(s.project, ref) ||
                  (sharedFace && !paintShared)
                }
                onChange={(e) => s.setFaceColor(ref, e.target.value)}
              />
            </label>
          )}
          {ref.occurrencePath.length === 0 ? (
            <button className="start-card" onClick={() => s.groupScene()}>
              Сгруппировать всю геометрию сцены
            </button>
          ) : (
            (() => {
              const p = s.project;
              if (p.schemaVersion !== 2) return null;
              const key = ref.occurrencePath.at(-1)!,
                node = p.nodes[key];
              if (node.kind === "legacy-primitive") return null;
              const locked = isObjectLocked(p, key),
                definition = p.definitions[node.definitionId],
                shared =
                  Object.values(p.nodes).filter(
                    (n) =>
                      n.kind !== "legacy-primitive" &&
                      n.definitionId === definition.id,
                  ).length > 1;
              return (
                <div className="property-group">
                  <h3>{node.name}</h3>
                  {(["translation", "scale"] as const).map((field) => (
                    <div key={field}>
                      <label>
                        {field === "translation"
                          ? "Положение группы"
                          : "Масштаб группы"}
                      </label>
                      <div className="vector-fields">
                        {node.transform[field].map((v, i) => (
                          <NumberField
                            key={i}
                            value={field === "translation" ? v * factor : v}
                            label={`${field === "translation" ? "Положение группы" : "Масштаб группы"} ${["X", "Y", "Z"][i]}`}
                            disabled={locked}
                            onCommit={(value) => {
                              const transform = structuredClone(node.transform);
                              transform[field][i] =
                                field === "translation"
                                  ? value / factor
                                  : value;
                              s.patchNode(key, { transform });
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                  {node.parentDefinitionId === p.rootDefinitionId &&
                    !definition.childNodeIds.length && (
                      <button
                        className="start-card"
                        disabled={locked}
                        onClick={() => s.copyInstance(key)}
                      >
                        Создать связанный экземпляр
                      </button>
                    )}
                  {shared && !definition.childNodeIds.length && (
                    <button
                      className="start-card"
                      disabled={locked}
                      onClick={() => s.makeUnique(key)}
                    >
                      Сделать независимым
                    </button>
                  )}
                  {node.parentDefinitionId === p.rootDefinitionId &&
                    !definition.childNodeIds.length && (
                      <button
                        className="start-card"
                        disabled={locked}
                        onClick={() => s.removeInstance(key)}
                      >
                        Удалить сборку
                      </button>
                    )}
                  <p>
                    {shared
                      ? "Общая геометрия: изменение формы затронет все связанные экземпляры."
                      : "Независимая геометрия."}
                  </p>
                </div>
              );
            })()
          )}
          {face && (
            <button
              className="start-card"
              disabled={
                s.topologySelections.length > 1 ||
                isGeometryLocked(s.project, ref)
              }
              onClick={() =>
                void s.editGeometry(ref, {
                  kind: "delete-entities",
                  entityIds: [ref.entityId],
                })
              }
            >
              Удалить грань
            </button>
          )}
          {face && (
            <button
              className="start-card"
              disabled={
                s.topologySelections.length !== 1 ||
                isGeometryLocked(s.project, ref)
              }
              onClick={() => s.setTool("extrude")}
            >
              Вытянуть / вдавить (P)
            </button>
          )}
        </div>
      </aside>
    );
  }
  function transform(
    key: keyof SceneObject["transform"],
    i: number,
    value: number,
  ) {
    if (!o) return;
    const t = structuredClone(o.transform);
    t[key][i] = key === "position" ? value / factor : value;

    s.patch(o.id, { transform: t });
  }
  return (
    <aside className="properties">
      <div className="panel-heading">
        Свойства <span className="micro">ОБЪЕКТ</span>
      </div>
      {o ? (
        <>
          <div className="object-summary">
            <div className="object-icon">
              <Box size={21} />
            </div>
            <div>
              <input
                aria-label="Название объекта"
                className="object-name"
                disabled={objectLocked}
                value={o.name}
                onChange={(e) =>
                  s.patch(o.id, { name: e.target.value.slice(0, 200) })
                }
              />
              <small>{primitiveNames[o.type]} · Примитив</small>
            </div>
          </div>
          <div className="section-title">
            <ChevronDown size={13} /> Трансформация{" "}
            <span>{ru.units[s.project.units]}</span>
          </div>
          {(["position", "rotation", "scale"] as const).map((key, k) => (
            <div className="property-group" key={key}>
              <label>
                {["Положение", "Вращение", "Масштаб"][k]}
                <small>{["", "°", "×"][k]}</small>
              </label>
              <div className="vector-fields">
                {o.transform[key].map((v, i) => (
                  <NumberField
                    key={i}
                    value={key === "position" ? v * factor : v}
                    label={`${["Положение", "Вращение", "Масштаб"][k]} ${["X", "Y", "Z"][i]}`}
                    disabled={objectLocked}
                    onCommit={(n) => transform(key, i, n)}
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="section-title">
            <ChevronDown size={13} /> Материал <span>СТАНДАРТНЫЙ</span>
          </div>
          <div className="material-card">
            <div
              className="material-orb"
              style={{ background: o.material.color }}
            />
            <div>
              <strong>Материал объекта</strong>
              <small>Стандартная поверхность</small>
            </div>
          </div>
          <label className="property-row">
            Цвет{" "}
            <span>
              <input
                aria-label="Цвет материала"
                type="color"
                disabled={objectLocked}
                value={o.material.color}
                onChange={(e) =>
                  s.patch(o.id, {
                    material: { ...o.material, color: e.target.value },
                  })
                }
              />
              <code>{o.material.color.toUpperCase()}</code>
            </span>
          </label>
          <label className="property-row">
            Шероховатость{" "}
            <input
              aria-label="Шероховатость"
              type="range"
              min="0"
              max="1"
              step="0.01"
              disabled={objectLocked}
              value={o.material.roughness}
              onChange={(e) =>
                s.patch(o.id, {
                  material: {
                    ...o.material,
                    roughness: Number(e.target.value),
                  },
                })
              }
            />
          </label>
          <label className="property-row">
            Металличность{" "}
            <input
              aria-label="Металличность"
              type="range"
              min="0"
              max="1"
              step="0.01"
              disabled={objectLocked}
              value={o.material.metalness}
              onChange={(e) =>
                s.patch(o.id, {
                  material: {
                    ...o.material,
                    metalness: Number(e.target.value),
                  },
                })
              }
            />
          </label>
          <div className="section-title">
            <ChevronDown size={13} /> Объект
          </div>
          <label className="property-row">
            Видимость{" "}
            <input
              type="checkbox"
              checked={o.visible}
              onChange={(e) => s.patch(o.id, { visible: e.target.checked })}
              disabled={objectLocked}
            />
          </label>
          <label className="property-row">
            Заблокировать{" "}
            <input
              type="checkbox"
              checked={o.locked}
              disabled={ancestorLocked}
              onChange={(e) => s.setLocked(o.id, e.target.checked)}
            />
          </label>
          <div className="object-actions">
            <button disabled={objectLocked} onClick={s.duplicate}>
              <Copy size={14} /> Дубликат
            </button>
            <button
              disabled={objectLocked}
              onClick={s.remove}
              aria-label="Удалить объект"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </>
      ) : (
        <div className="empty-properties">
          <Box size={34} />
          <h3>Каждая идея начинается с формы</h3>
          <p>
            Создайте объект или выберите его в сцене, чтобы изменить свойства.
          </p>
          <button onClick={() => s.add("cube")}>Создать куб</button>
        </div>
      )}
      <div className="panel-bottom">
        <span className="mint-dot" /> Все изменения — в вашем проекте
      </div>
    </aside>
  );
}
