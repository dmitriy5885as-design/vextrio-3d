import {
  entityTables,
  GeometryError,
  type EntityTables,
  type GeometryModel,
  type Id,
  type TableName,
  type EntityKind,
} from "./model";
import {
  canonical,
  validateGeometry,
  type ValidationContext,
} from "./validate";
export type EntityChange<K extends TableName> = {
  id: string;
  before: EntityTables[K][string] | null;
  after: EntityTables[K][string] | null;
};
export type GeometryDelta = { geometryId: Id<"geometry"> } & {
  [K in TableName]: EntityChange<K>[];
};
export interface LineageEntry {
  operationId: Id<"operation">;
  kind: EntityKind;
  retiredId: string;
  descendants: { id: string; parameterRange?: [number, number] }[];
  reason: "split" | "merge" | "delete" | "convert";
}
export interface PreparedGeometryChange {
  forward: GeometryDelta;
  inverse: GeometryDelta;
  lineage: LineageEntry[];
}
export function diffGeometry(
  before: GeometryModel,
  after: GeometryModel,
): GeometryDelta {
  if (
    before.id !== after.id ||
    before.ownerDefinitionId !== after.ownerDefinitionId ||
    before.representation !== after.representation
  )
    throw new GeometryError(
      "INVALID_TOPOLOGY",
      "Delta cannot change geometry ownership or representation",
    );
  const delta = { geometryId: before.id } as GeometryDelta;
  for (const table of entityTables) {
    const changes: EntityChange<TableName>[] = [];
    for (const key of [
      ...new Set([...Object.keys(before[table]), ...Object.keys(after[table])]),
    ].sort()) {
      const old = Object.hasOwn(before[table], key) ? before[table][key] : null,
        next = Object.hasOwn(after[table], key) ? after[table][key] : null;
      if (canonical(old) !== canonical(next))
        changes.push({
          id: key,
          before: structuredClone(old),
          after: structuredClone(next),
        });
    }
    Object.assign(delta, { [table]: changes });
  }
  return delta;
}
export function invertDelta(delta: GeometryDelta): GeometryDelta {
  const result = structuredClone(delta);
  for (const table of entityTables)
    for (const change of result[table])
      [change.before, change.after] = [change.after, change.before];
  return result;
}
export function applyDelta(
  model: GeometryModel,
  delta: GeometryDelta,
  context: ValidationContext,
): GeometryModel {
  canonical(delta);
  validateGeometry(model, context);
  if (delta.geometryId !== model.id)
    throw new GeometryError(
      "INVALID_TOPOLOGY",
      "Delta targets another geometry",
    );
  const next = structuredClone(model);
  for (const table of entityTables) {
    if (!Array.isArray(delta[table]))
      throw new GeometryError("INVALID_TOPOLOGY", "Missing delta table");
    const seen = new Set<string>();
    for (const change of delta[table]) {
      const current = Object.hasOwn(model[table], change.id)
        ? model[table][change.id]
        : null;
      if (
        seen.has(change.id) ||
        canonical(current) !== canonical(change.before) ||
        (change.after?.id !== undefined && change.after.id !== change.id) ||
        (change.before === null && change.after === null)
      )
        throw new GeometryError(
          "INVALID_TOPOLOGY",
          "Delta precondition mismatch",
          [change.id],
        );
      seen.add(change.id);
      if (change.after === null) delete next[table][change.id];
      else
        Object.defineProperty(next[table], change.id, {
          value: structuredClone(change.after),
          enumerable: true,
          writable: true,
          configurable: true,
        });
    }
  }
  validateGeometry(next, context);
  return next;
}
export function validatePrepared(
  model: GeometryModel,
  change: PreparedGeometryChange,
  context: ValidationContext,
  operationId: Id<"operation">,
): GeometryModel {
  canonical(change);
  if (canonical(invertDelta(change.forward)) !== canonical(change.inverse))
    throw new GeometryError(
      "INVALID_TOPOLOGY",
      "Inverse does not restore exact entities",
    );
  const next = applyDelta(model, change.forward, context);
  if (canonical(applyDelta(next, change.inverse, context)) !== canonical(model))
    throw new GeometryError("INVALID_TOPOLOGY", "Inverse mismatch");
  const kinds: Record<EntityKind, TableName> = {
    vertex: "vertices",
    edge: "edges",
    coedge: "coedges",
    loop: "loops",
    face: "faces",
    shell: "shells",
    body: "bodies",
  };
  const retired = new Set<string>();
  for (const entry of change.lineage) {
    const table = kinds[entry.kind];
    if (
      !table ||
      entry.operationId !== operationId ||
      retired.has(entry.retiredId) ||
      !Object.hasOwn(model[table], entry.retiredId) ||
      Object.hasOwn(next[table], entry.retiredId) ||
      !["split", "merge", "delete", "convert"].includes(entry.reason)
    )
      throw new GeometryError("INVALID_TOPOLOGY", "Invalid lineage retirement");
    retired.add(entry.retiredId);
    const descendants = new Set<string>();
    if (
      (entry.reason === "delete" && entry.descendants.length) ||
      (entry.reason === "split" && entry.descendants.length < 2)
    )
      throw new GeometryError(
        "INVALID_TOPOLOGY",
        "Invalid lineage cardinality",
      );
    for (const child of entry.descendants) {
      if (
        descendants.has(child.id) ||
        !Object.hasOwn(next[table], child.id) ||
        (Object.hasOwn(model[table], child.id) &&
          !(entry.kind === "vertex" && entry.reason === "merge"))
      )
        throw new GeometryError(
          "INVALID_TOPOLOGY",
          "Invalid lineage descendant",
        );
      descendants.add(child.id);
      if (
        child.parameterRange &&
        (child.parameterRange.length !== 2 ||
          !child.parameterRange.every(Number.isFinite) ||
          child.parameterRange[0] < 0 ||
          child.parameterRange[1] > 1 ||
          child.parameterRange[0] >= child.parameterRange[1])
      )
        throw new GeometryError(
          "INVALID_TOPOLOGY",
          "Invalid lineage parameter interval",
        );
    }
  }
  for (const table of entityTables)
    for (const patch of change.forward[table])
      if (
        patch.before !== null &&
        patch.after === null &&
        !retired.has(patch.id)
      )
        throw new GeometryError(
          "INVALID_TOPOLOGY",
          "Deleted entity requires lineage",
          [patch.id],
        );
  return next;
}
