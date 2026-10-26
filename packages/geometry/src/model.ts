declare const brand: unique symbol;
export type Id<K extends string> = string & { readonly [brand]: K };
export type EntityKind =
  "vertex" | "edge" | "coedge" | "loop" | "face" | "shell" | "body";
export type Vec3 = [number, number, number];
export type Vec2 = [number, number];
export type Table<T extends { id: string }> = Record<string, T>;
export interface Vertex {
  id: Id<"vertex">;
  position: Vec3;
  role?: "construction";
}
export interface Edge {
  id: Id<"edge">;
  start: Id<"vertex">;
  end: Id<"vertex">;
  curve: { kind: "line" };
}
export interface Coedge {
  id: Id<"coedge">;
  edgeId: Id<"edge">;
  direction: 1 | -1;
  loopId: Id<"loop">;
}
export interface Loop {
  id: Id<"loop">;
  coedgeIds: Id<"coedge">[];
}
export interface PlaneFrame {
  origin: Vec3;
  u: Vec3;
  v: Vec3;
  normal: Vec3;
}
export interface Face {
  id: Id<"face">;
  plane: PlaneFrame;
  outerLoopId: Id<"loop">;
  innerLoopIds: Id<"loop">[];
  frontMaterialId: Id<"material">;
  backMaterialId: Id<"material">;
}
export interface Shell {
  id: Id<"shell">;
  faces: { faceId: Id<"face">; orientation: 1 | -1 }[];
}
export interface Body {
  id: Id<"body">;
  vertexIds: Id<"vertex">[];
  edgeIds: Id<"edge">[];
  faceIds: Id<"face">[];
  shellIds: Id<"shell">[];
}
export interface EntityTables {
  vertices: Table<Vertex>;
  edges: Table<Edge>;
  coedges: Table<Coedge>;
  loops: Table<Loop>;
  faces: Table<Face>;
  shells: Table<Shell>;
  bodies: Table<Body>;
}
export interface GeometryModel extends EntityTables {
  id: Id<"geometry">;
  ownerDefinitionId: Id<"definition">;
  representation: "planar-topology";
}
export const entityTables = [
  "vertices",
  "edges",
  "coedges",
  "loops",
  "faces",
  "shells",
  "bodies",
] as const;
export type TableName = (typeof entityTables)[number];
export interface GeometryPolicy {
  version: 1;
  absoluteDistance: number;
  relativeDistance: number;
  angular: number;
  maxTransformCondition: number;
}
export const defaultPolicy: Readonly<GeometryPolicy> = Object.freeze({
  version: 1,
  absoluteDistance: 1e-7,
  relativeDistance: 1e-12,
  angular: 1e-10,
  maxTransformCondition: 1e8,
});
export type DiagnosticCode =
  | "DEGENERATE"
  | "NON_PLANAR"
  | "NUMERICAL_AMBIGUITY"
  | "STALE_REVISION"
  | "LOCKED"
  | "UNSUPPORTED_OPERATION"
  | "INVALID_TOPOLOGY"
  | "RESOURCE_LIMIT";
export interface Diagnostic {
  code: DiagnosticCode;
  message: string;
  entityIds: string[];
}
export class GeometryError extends Error {
  readonly diagnostic: Diagnostic;
  constructor(code: DiagnosticCode, message: string, entityIds: string[] = []) {
    super(message);
    this.diagnostic = { code, message, entityIds };
  }
}
export function id<K extends string>(value: string): Id<K> {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/.test(value)
  )
    throw new GeometryError("INVALID_TOPOLOGY", "Invalid entity ID");
  return value as Id<K>;
}
// Replay uses recorded deltas, never the allocator. The caller supplies all
// reserved IDs, including retired entities, and a document-unique operation ID.
export function createIdAllocator(
  operationId: Id<"operation">,
  reserved: Iterable<string> = [],
) {
  id(operationId);
  const used = new Set(reserved);
  let sequence = 0;
  return <K extends EntityKind>(kind: K): Id<K> => {
    let candidate: Id<K>;
    do {
      candidate = id<K>(`${operationId}/${kind}/${sequence++}`);
    } while (used.has(candidate));
    used.add(candidate);
    return candidate;
  };
}
export function emptyGeometry(
  geometryId: Id<"geometry">,
  ownerDefinitionId: Id<"definition">,
): GeometryModel {
  return {
    id: geometryId,
    ownerDefinitionId,
    representation: "planar-topology",
    vertices: {},
    edges: {},
    coedges: {},
    loops: {},
    faces: {},
    shells: {},
    bodies: {},
  };
}
