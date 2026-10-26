import {
  type ProjectV2,
  type EntityRef,
  validateEntityRef,
} from "@forma/document";
import { id, entityTables, type GeometryModel } from "@forma/geometry";
const fresh = <K extends string>(kind: K) =>
  id<K>(kind + "/" + crypto.randomUUID());
export function groupSceneGeometry(
  p: ProjectV2,
  kind: "group" | "component",
  selection: EntityRef | null,
): EntityRef | null {
  const root = p.definitions[p.rootDefinitionId],
    gid = root.geometryId;
  if (!gid) throw Error("В сцене нет отдельной геометрии для группировки.");
  const did = fresh("definition"),
    nid = fresh("node"),
    name =
      (kind === "group" ? "Группа " : "Компонент ") +
      Object.keys(p.definitions).length;
  p.definitions[did] = {
    id: did,
    name,
    kind,
    geometryId: gid,
    childNodeIds: [],
  };
  p.geometries[gid].ownerDefinitionId = did;
  root.geometryId = null;
  root.childNodeIds.push(nid);
  p.nodes[nid] = {
    id: nid,
    name,
    kind,
    parentDefinitionId: root.id,
    definitionId: did,
    visible: true,
    locked: false,
    transform: {
      translation: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    },
  };
  for (const r of Object.values(p.references))
    if (r.target.geometryId === gid) {
      r.target.definitionId = did;
      r.target.occurrencePath = [nid];
    }
  const next =
    selection?.geometryId === gid
      ? { ...selection, definitionId: did, occurrencePath: [nid] }
      : null;
  if (next) validateEntityRef(p, next);
  return next;
}
export function copyInstance(p: ProjectV2, nodeId: string): string {
  const node = p.nodes[nodeId];
  if (
    !node ||
    node.kind === "legacy-primitive" ||
    node.parentDefinitionId !== p.rootDefinitionId
  )
    throw Error("Связанный экземпляр создаётся для объекта верхнего уровня.");
  const definition = p.definitions[node.definitionId];
  if (definition.childNodeIds.length)
    throw Error("Для вложенной сборки копирование будет добавлено отдельно.");
  definition.kind = "component";
  node.kind = "component";
  const key = fresh("node"),
    copy = structuredClone(node);
  copy.id = key;
  copy.name = node.name + " · экземпляр";
  copy.transform.translation[0] += 1;
  p.nodes[key] = copy;
  p.definitions[p.rootDefinitionId].childNodeIds.push(key);
  return key;
}
export function makeUnique(p: ProjectV2, nodeId: string): string {
  const node = p.nodes[nodeId];
  if (!node || node.kind === "legacy-primitive")
    throw Error("Выберите экземпляр компонента.");
  const source = p.definitions[node.definitionId];
  if (source.childNodeIds.length)
    throw Error("Отделение вложенной сборки будет добавлено отдельно.");
  if (
    Object.values(p.nodes).filter(
      (n) => n.kind !== "legacy-primitive" && n.definitionId === source.id,
    ).length < 2
  )
    throw Error("Этот объект уже независим.");
  const did = fresh("definition"),
    gid = source.geometryId ? fresh("geometry") : null,
    definition = structuredClone(source);
  definition.id = did;
  definition.geometryId = gid;
  definition.name += " · независимый";
  p.definitions[did] = definition;
  node.definitionId = did;
  node.name = definition.name;
  if (gid && source.geometryId) {
    const g = structuredClone(p.geometries[source.geometryId]),
      map = new Map<string, string>();
    for (const table of entityTables)
      for (const key of Object.keys(g[table])) map.set(key, fresh(table));
    const mapped = (key: string) => map.get(key)!;
    g.id = gid;
    g.ownerDefinitionId = did;
    for (const table of entityTables) {
      const records = Object.values(g[table]).map((value) => {
        const next = structuredClone(value) as unknown as Record<
          string,
          unknown
        >;
        next.id = mapped(value.id);
        for (const field of ["start", "end", "edgeId", "loopId", "outerLoopId"])
          if (typeof next[field] === "string")
            next[field] = mapped(next[field] as string);
        for (const field of [
          "coedgeIds",
          "innerLoopIds",
          "vertexIds",
          "edgeIds",
          "faceIds",
          "shellIds",
        ])
          if (Array.isArray(next[field]))
            next[field] = (next[field] as string[]).map(mapped);
        if (table === "shells")
          next.faces = (
            next.faces as { faceId: string; orientation: number }[]
          ).map((f) => ({ ...f, faceId: mapped(f.faceId) }));
        return [next.id, next];
      });
      Object.assign(g, { [table]: Object.fromEntries(records) });
    }
    p.geometries[gid] = g as GeometryModel;
    for (const r of Object.values(p.references))
      if (
        r.target.occurrencePath.includes(nodeId) &&
        r.target.geometryId === source.geometryId
      ) {
        const entity = map.get(r.target.entityId);
        if (!entity)
          throw Error(
            "Нельзя отделить экземпляр с исторической ссылкой на удалённую сущность.",
          );
        r.target = {
          ...r.target,
          definitionId: did,
          geometryId: gid,
          entityId: entity,
        };
      }
  }
  return did;
}
export function removeInstance(p: ProjectV2, nodeId: string) {
  const n = p.nodes[nodeId];
  if (
    !n ||
    n.kind === "legacy-primitive" ||
    n.parentDefinitionId !== p.rootDefinitionId
  )
    throw Error("Удаление сборки доступно для верхнего уровня.");
  const d = p.definitions[n.definitionId];
  if (d.childNodeIds.length) throw Error("Сначала разберите вложенную сборку.");
  delete p.nodes[nodeId];
  const root = p.definitions[p.rootDefinitionId];
  root.childNodeIds = root.childNodeIds.filter((key) => key !== nodeId);
  for (const [key, r] of Object.entries(p.references))
    if (r.target.occurrencePath.includes(nodeId)) delete p.references[key];
  if (
    !Object.values(p.nodes).some(
      (node) => node.kind !== "legacy-primitive" && node.definitionId === d.id,
    )
  ) {
    delete p.definitions[d.id];
    if (d.geometryId) {
      delete p.geometries[d.geometryId];
      p.provenance = p.provenance.filter((l) => l.geometryId !== d.geometryId);
    }
  }
}
