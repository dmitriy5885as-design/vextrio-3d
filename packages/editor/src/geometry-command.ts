import type { Command } from "@forma/commands";
import { clone } from "@forma/shared";
import {
  geometryContext,
  validateEntityRef,
  type Document,
  type EntityRef,
} from "@forma/document";
import { applyDelta, type PreparedGeometryChange } from "@forma/geometry";
import { isGeometryLocked } from "./permissions";
export class GeometryDocumentCommand implements Command {
  private change: PreparedGeometryChange;
  constructor(
    public label: string,
    private ref: EntityRef,
    change: PreparedGeometryChange,
  ) {
    this.change = clone(change);
    this.ref = clone(ref);
  }
  execute(p: Document): Document {
    if (p.schemaVersion !== 2) throw Error("Геометрической команде нужен v2.");
    validateEntityRef(p, this.ref);
    if (isGeometryLocked(p, this.ref)) throw Error("Геометрия заблокирована.");
    const next = clone(p);
    next.geometries[this.ref.geometryId] = applyDelta(
      p.geometries[this.ref.geometryId],
      this.change.forward,
      geometryContext(p, this.ref.geometryId, false, this.ref.occurrencePath),
    );
    next.provenance.push(
      ...this.change.lineage.map((l) => ({
        ...clone(l),
        geometryId: this.ref.geometryId,
      })),
    );
    return next;
  }
  undo(p: Document): Document {
    if (p.schemaVersion !== 2) throw Error("Геометрической команде нужен v2.");
    const next = clone(p);
    next.geometries[this.ref.geometryId] = applyDelta(
      p.geometries[this.ref.geometryId],
      this.change.inverse,
      geometryContext(p, this.ref.geometryId, false, this.ref.occurrencePath),
    );
    const operations = new Set(this.change.lineage.map((l) => l.operationId));
    next.provenance = next.provenance.filter(
      (l) =>
        l.geometryId !== this.ref.geometryId || !operations.has(l.operationId),
    );
    return next;
  }
}
