import type { Command } from "@forma/commands";
import { clone } from "@forma/shared";
import {
  geometryContext,
  validateEntityRef,
  definitionAtPath,
  type Material,
  type Document,
  type EntityRef,
} from "@forma/document";
import {
  applyDelta,
  canonical,
  type GeometryModel,
  type PreparedGeometryChange,
} from "@forma/geometry";
import { isGeometryLocked } from "./permissions";
export class GeometryDocumentCommand implements Command {
  private change: PreparedGeometryChange;
  constructor(
    public label: string,
    private ref:
      | EntityRef
      | Pick<EntityRef, "definitionId" | "geometryId" | "occurrencePath">,
    change: PreparedGeometryChange,
    private seed: { geometry?: GeometryModel; material?: Material } = {},
  ) {
    this.change = clone(change);
    this.ref = clone(ref);
    this.seed = clone(seed);
  }
  execute(p: Document): Document {
    if (p.schemaVersion !== 2) throw Error("Геометрической команде нужен v2.");
    if ("kind" in this.ref) validateEntityRef(p, this.ref);
    if (definitionAtPath(p, this.ref.occurrencePath) !== this.ref.definitionId)
      throw Error("Контекст геометрии изменился.");
    if (isGeometryLocked(p, this.ref)) throw Error("Геометрия заблокирована.");
    const next = clone(p);
    if (this.seed.geometry) {
      if (
        next.definitions[this.ref.definitionId].geometryId ||
        next.geometries[this.ref.geometryId]
      )
        throw Error("Геометрический контекст уже существует.");
      next.geometries[this.ref.geometryId] = clone(this.seed.geometry);
      next.definitions[this.ref.definitionId].geometryId =
        this.seed.geometry.id;
    }
    if (this.seed.material) {
      if (next.materials[this.seed.material.id])
        throw Error("Материал уже существует.");
      next.materials[this.seed.material.id] = clone(this.seed.material);
    }
    if (
      next.definitions[this.ref.definitionId].geometryId !== this.ref.geometryId
    )
      throw Error("Неверное владение геометрией.");
    next.geometries[this.ref.geometryId] = applyDelta(
      next.geometries[this.ref.geometryId],
      this.change.forward,
      geometryContext(
        next,
        this.ref.geometryId,
        false,
        this.ref.occurrencePath,
      ),
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
    if (this.seed.geometry) {
      if (
        canonical(next.geometries[this.ref.geometryId]) !==
        canonical(this.seed.geometry)
      )
        throw Error("Undo не восстановил исходный геометрический контекст.");
      delete next.geometries[this.ref.geometryId];
      next.definitions[this.ref.definitionId].geometryId = null;
    }
    if (this.seed.material) delete next.materials[this.seed.material.id];
    return next;
  }
}
