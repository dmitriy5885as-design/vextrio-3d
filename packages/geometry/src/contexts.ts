import {
  entityTables,
  GeometryError,
  id,
  type GeometryModel,
  type GeometryPolicy,
  type Id,
  type Table,
} from "./model";
import { validateTransform, type PlacementTransform } from "./math";
import { canonical, validateGeometry } from "./validate";
export interface Definition {
  id: Id<"definition">;
  name: string;
  kind: "scene" | "group" | "component";
  geometryId: Id<"geometry"> | null;
  childNodeIds: Id<"node">[];
}
export interface InstanceNode {
  id: Id<"node">;
  name: string;
  parentDefinitionId: Id<"definition">;
  definitionId: Id<"definition">;
  kind: "group" | "component";
  transform: PlacementTransform;
  visible: boolean;
  locked: boolean;
}
export interface GeometryCatalog {
  rootDefinitionId: Id<"definition">;
  definitions: Table<Definition>;
  nodes: Table<InstanceNode>;
  geometries: Table<GeometryModel>;
  materialIds: Id<"material">[];
}
// Infrastructure catalog, deliberately not a ProjectV2 file schema or migrator.
export function validateCatalog(c: GeometryCatalog, policy?: GeometryPolicy) {
  canonical(c);
  const all = new Set<string>(),
    claim = (key: string, value: { id: string }) => {
      id(key);
      if (value.id !== key || all.has(key))
        throw new GeometryError(
          "INVALID_TOPOLOGY",
          "Duplicate/mismatched catalog ID",
          [key],
        );
      all.add(key);
    };
  for (const table of [c.definitions, c.nodes, c.geometries])
    for (const [key, value] of Object.entries(table)) claim(key, value);
  for (const materialId of c.materialIds) claim(materialId, { id: materialId });
  if (all.size > 20000)
    throw new GeometryError("RESOURCE_LIMIT", "Catalog entity limit exceeded");
  const root = c.definitions[c.rootDefinitionId];
  if (!root || root.kind !== "scene")
    throw new GeometryError("INVALID_TOPOLOGY", "Missing scene root");
  const nodeOwners = new Set<string>(),
    geometryOwners = new Set<string>(),
    instances = new Map<string, number>();
  for (const d of Object.values(c.definitions)) {
    if (
      typeof d.name !== "string" ||
      d.name.length > 200 ||
      !["scene", "group", "component"].includes(d.kind) ||
      (d.kind === "scene" && d.id !== c.rootDefinitionId)
    )
      throw new GeometryError("INVALID_TOPOLOGY", "Invalid definition");
    if (d.geometryId !== null) {
      const m = c.geometries[d.geometryId];
      if (!m || m.ownerDefinitionId !== d.id || geometryOwners.has(m.id))
        throw new GeometryError(
          "INVALID_TOPOLOGY",
          "Geometry definition ownership mismatch",
        );
      geometryOwners.add(m.id);
    }
    if (!Array.isArray(d.childNodeIds))
      throw new GeometryError("INVALID_TOPOLOGY", "Invalid child list");
    for (const nid of d.childNodeIds) {
      const n = c.nodes[nid];
      if (!n || n.parentDefinitionId !== d.id || nodeOwners.has(nid))
        throw new GeometryError("INVALID_TOPOLOGY", "Node ownership mismatch");
      nodeOwners.add(nid);
    }
  }
  if (
    nodeOwners.size !== Object.keys(c.nodes).length ||
    geometryOwners.size !== Object.keys(c.geometries).length
  )
    throw new GeometryError("INVALID_TOPOLOGY", "Orphan catalog entry");
  for (const n of Object.values(c.nodes)) {
    const d = c.definitions[n.definitionId];
    if (
      !d ||
      d.id === c.rootDefinitionId ||
      n.kind !== d.kind ||
      !["group", "component"].includes(n.kind) ||
      typeof n.name !== "string" ||
      n.name.length > 200 ||
      typeof n.visible !== "boolean" ||
      typeof n.locked !== "boolean"
    )
      throw new GeometryError(
        "INVALID_TOPOLOGY",
        "Invalid instance definition",
      );
    validateTransform(n.transform, policy);
    instances.set(d.id, (instances.get(d.id) ?? 0) + 1);
  }
  for (const d of Object.values(c.definitions))
    if (
      d.id !== root.id &&
      (!instances.has(d.id) ||
        (d.kind === "group" && instances.get(d.id) !== 1))
    )
      throw new GeometryError(
        "INVALID_TOPOLOGY",
        "A group requires exactly one placement",
      );
  // Iterative DFS keeps a deep, valid instance graph off the JS call stack.
  const color = new Map<string, number>(),
    stack: { id: string; leave: boolean }[] = [{ id: root.id, leave: false }];
  while (stack.length) {
    const entry = stack.pop()!;
    if (entry.leave) {
      color.set(entry.id, 2);
      continue;
    }
    if (color.get(entry.id) === 1)
      throw new GeometryError("INVALID_TOPOLOGY", "Cyclic definition graph");
    if (color.get(entry.id) === 2) continue;
    color.set(entry.id, 1);
    stack.push({ ...entry, leave: true });
    for (const nid of c.definitions[entry.id].childNodeIds)
      stack.push({ id: c.nodes[nid].definitionId, leave: false });
  }
  if (color.size !== Object.keys(c.definitions).length)
    throw new GeometryError("INVALID_TOPOLOGY", "Unreachable definition");
  for (const m of Object.values(c.geometries)) {
    validateGeometry(m, {
      ownerDefinitionId: m.ownerDefinitionId,
      materialIds: new Set(c.materialIds),
      reservedIds: new Set(
        [...all].filter((key) => key !== m.id && key !== m.ownerDefinitionId),
      ),
      policy,
    });
    for (const table of entityTables)
      for (const entity of Object.values(m[table])) claim(entity.id, entity);
  }
}
