import {
  defaultPolicy,
  entityTables,
  GeometryError,
  id,
  type Diagnostic,
  type GeometryModel,
  type GeometryPolicy,
  type Id,
  type PlaneFrame,
  type Vec3,
} from "./model";
import {
  canonical,
  validateGeometry,
  type ValidationContext,
} from "./validate";
import {
  applyDelta,
  diffGeometry,
  invertDelta,
  validatePrepared,
  type PreparedGeometryChange,
} from "./transactions";
export type GeometryIntent =
  | {
      kind: "move-vertices";
      positions: { vertexId: Id<"vertex">; position: Vec3 }[];
    }
  | {
      kind: "insert-segments";
      segments: [Vec3, Vec3][];
      plane: PlaneFrame | null;
    }
  | { kind: "make-face"; boundaryEdgeIds: Id<"edge">[] }
  | { kind: "delete-entities"; entityIds: string[] };
export interface Envelope {
  protocolVersion: 1;
  sessionId: Id<"session">;
  requestId: Id<"request">;
  operationId: Id<"operation">;
  baseRevision: number;
  geometryPolicyVersion: 1;
}
export interface GeometryRequest extends Envelope {
  intent: GeometryIntent;
  mode: "preview" | "commit";
  model: GeometryModel;
  policy: GeometryPolicy;
}
export type GeometryResponse = Envelope &
  (
    | { status: "proposed"; change: PreparedGeometryChange }
    | { status: "noop" }
    | { status: "error"; diagnostics: Diagnostic[] }
  );
export interface GeometryBackend {
  propose(request: GeometryRequest): Promise<GeometryResponse>;
}
function diagnostic(error: unknown): Diagnostic {
  return error instanceof GeometryError
    ? error.diagnostic
    : {
        code: "INVALID_TOPOLOGY",
        message: "Geometry backend failed",
        entityIds: [],
      };
}
function frozen<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
}
function copyContext(context: ValidationContext): ValidationContext {
  return {
    ...context,
    materialIds: new Set(context.materialIds),
    policy: frozen(structuredClone(context.policy ?? defaultPolicy)),
    reservedIds: context.reservedIds ? new Set(context.reservedIds) : undefined,
    placement: context.placement
      ? frozen(structuredClone(context.placement))
      : undefined,
  };
}
export type OperationResult =
  | { status: "applied" | "noop" | "stale" | "cancelled" }
  | { status: "preview"; model: GeometryModel }
  | { status: "error"; diagnostics: Diagnostic[] };
// A reference async port for tests and future Worker transport. Only moving
// existing vertices is implemented here; contour construction belongs to S3.
export function createLocalGeometryBackend(
  context: ValidationContext,
): GeometryBackend {
  context = copyContext(context);
  return {
    async propose(request) {
      const { model, intent, ...envelope } = request;
      const reply: Envelope = {
        protocolVersion: 1,
        sessionId: envelope.sessionId,
        requestId: envelope.requestId,
        operationId: envelope.operationId,
        baseRevision: envelope.baseRevision,
        geometryPolicyVersion: 1,
      };
      try {
        validateGeometry(model, { ...context, policy: request.policy });
        if (intent.kind !== "move-vertices")
          throw new GeometryError(
            "UNSUPPORTED_OPERATION",
            "Contour construction and deletion are not implemented in S2",
          );
        const after = structuredClone(model),
          seen = new Set<string>();
        for (const move of intent.positions) {
          if (!after.vertices[move.vertexId] || seen.has(move.vertexId))
            throw new GeometryError(
              "INVALID_TOPOLOGY",
              "Missing/duplicate move vertex",
              [move.vertexId],
            );
          seen.add(move.vertexId);
          after.vertices[move.vertexId].position = structuredClone(
            move.position,
          );
        }
        validateGeometry(after, { ...context, policy: request.policy });
        const forward = diffGeometry(model, after);
        if (entityTables.every((t) => forward[t].length === 0))
          return { ...reply, status: "noop" };
        return {
          ...reply,
          status: "proposed",
          change: { forward, inverse: invertDelta(forward), lineage: [] },
        };
      } catch (error) {
        return { ...reply, status: "error", diagnostics: [diagnostic(error)] };
      }
    },
  };
}
// Independent geometry transaction harness. The v1 editor/store is intentionally
// unchanged; S4 will wrap these changes in full document transactions.
export class GeometrySession {
  private model: GeometryModel;
  private sessionId: Id<"session">;
  private revisionValue = 0;
  private sequence = 0;
  private pending = new Map<string, boolean>();
  private past: PreparedGeometryChange[] = [];
  private future: PreparedGeometryChange[] = [];
  private reserved = new Set<string>();
  private usedSessions = new Set<string>();
  private context: ValidationContext;
  private backend: GeometryBackend;
  constructor(
    model: GeometryModel,
    context: ValidationContext,
    backend: GeometryBackend,
    sessionId: Id<"session">,
  ) {
    validateGeometry(model, context);
    id(sessionId);
    this.model = frozen(structuredClone(model));
    this.context = copyContext(context);
    this.backend = backend;
    this.sessionId = sessionId;
    this.usedSessions.add(sessionId);
    this.reserve(model);
  }
  get snapshot() {
    return this.model;
  }
  get revision() {
    return this.revisionValue;
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  private reserve(model: GeometryModel) {
    for (const table of entityTables)
      for (const key of Object.keys(model[table])) this.reserved.add(key);
  }
  cancelAll() {
    for (const key of this.pending.keys()) this.pending.set(key, true);
  }
  replace(model: GeometryModel, sessionId: Id<"session">) {
    validateGeometry(model, this.context);
    id(sessionId);
    if (this.usedSessions.has(sessionId))
      throw new GeometryError(
        "STALE_REVISION",
        "Session ID must never be reused",
      );
    this.cancelAll();
    this.usedSessions.add(sessionId);
    this.sessionId = sessionId;
    this.model = frozen(structuredClone(model));
    this.revisionValue = 0;
    this.past = [];
    this.future = [];
    this.reserved.clear();
    this.reserve(model);
  }
  async execute(
    intent: GeometryIntent,
    mode: "preview" | "commit" = "commit",
    locked = false,
  ): Promise<OperationResult> {
    if (locked)
      return {
        status: "error",
        diagnostics: [
          {
            code: "LOCKED",
            message: "Geometry context is locked",
            entityIds: [],
          },
        ],
      };
    const requestId = id<"request">(`request/${this.sequence++}`),
      operationId = id<"operation">(`${requestId}/operation`);
    const envelope: Envelope = {
      protocolVersion: 1,
      sessionId: this.sessionId,
      requestId,
      operationId,
      baseRevision: this.revisionValue,
      geometryPolicyVersion: 1,
    };
    this.pending.set(requestId, false);
    try {
      const response = await this.backend.propose({
        ...envelope,
        intent: structuredClone(intent),
        mode,
        model: structuredClone(this.model),
        policy: structuredClone(this.context.policy!),
      });
      if (this.pending.get(requestId)) return { status: "cancelled" };
      if (
        this.sessionId !== envelope.sessionId ||
        this.revisionValue !== envelope.baseRevision
      )
        return { status: "stale" };
      canonical(response);
      for (const key of Object.keys(envelope) as (keyof Envelope)[])
        if (response[key] !== envelope[key])
          throw new GeometryError(
            "STALE_REVISION",
            "Backend response envelope mismatch",
          );
      if (response.status === "error")
        return {
          status: "error",
          diagnostics: structuredClone(response.diagnostics),
        };
      if (response.status === "noop") return { status: "noop" };
      if (response.status !== "proposed")
        throw new GeometryError("INVALID_TOPOLOGY", "Unknown backend response");
      const change = structuredClone(response.change),
        next = validatePrepared(this.model, change, this.context, operationId);
      if (canonical(this.model) === canonical(next)) return { status: "noop" };
      for (const table of entityTables)
        for (const patch of change.forward[table])
          if (patch.before === null && this.reserved.has(patch.id))
            throw new GeometryError("INVALID_TOPOLOGY", "Retired ID reuse", [
              patch.id,
            ]);
      if (mode === "preview") return { status: "preview", model: frozen(next) };
      this.model = frozen(next);
      this.reserve(next);
      this.past.push(frozen(change));
      if (this.past.length > 100) this.past.shift();
      this.future = [];
      this.revisionValue++;
      return { status: "applied" };
    } catch (error) {
      if (this.pending.get(requestId)) return { status: "cancelled" };
      if (
        this.sessionId !== envelope.sessionId ||
        this.revisionValue !== envelope.baseRevision
      )
        return { status: "stale" };
      return { status: "error", diagnostics: [diagnostic(error)] };
    } finally {
      this.pending.delete(requestId);
    }
  }
  undo() {
    return this.replay(this.past, this.future, true);
  }
  redo() {
    return this.replay(this.future, this.past, false);
  }
  private replay(
    from: PreparedGeometryChange[],
    to: PreparedGeometryChange[],
    inverse: boolean,
  ): OperationResult {
    const change = from.at(-1);
    if (!change) return { status: "noop" };
    try {
      const next = applyDelta(
        this.model,
        inverse ? change.inverse : change.forward,
        this.context,
      );
      this.model = frozen(next);
      from.pop();
      to.push(change);
      this.revisionValue++;
      return { status: "applied" };
    } catch (error) {
      return { status: "error", diagnostics: [diagnostic(error)] };
    }
  }
}
