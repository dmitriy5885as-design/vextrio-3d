# Предлагаемые контракты 0.2

Статус: проект типов для согласования, не добавлены в production и не являются готовым API. Имена уточняются в S2 без изменения описанной семантики. Все ссылки ниже — непрозрачные строки ID, а не индексы render arrays. В реализации применить branded types для разных видов ID.

## Документ и топология

```ts
type Id = string;
type Vec3 = [number, number, number];
type Quaternion = [number, number, number, number]; // x,y,z,w, нормирован
type Table<T extends { id: Id }> = Record<Id, T>;
type PlacementTransform = {
  translation: Vec3;
  rotation: Quaternion;
  scale: Vec3;
};
type PlaneFrame = { origin: Vec3; u: Vec3; v: Vec3; normal: Vec3 };
type EntityKind =
  "vertex" | "edge" | "coedge" | "loop" | "face" | "shell" | "body";

interface Vertex {
  id: Id;
  position: Vec3;
  role?: "construction";
}
interface Edge {
  id: Id;
  start: Id;
  end: Id;
  curve: { kind: "line" }; // v2.0 Sketch: только отрезки
}
interface Coedge {
  id: Id;
  edgeId: Id;
  direction: 1 | -1;
  loopId: Id;
}
interface Loop {
  id: Id;
  coedgeIds: Id[];
}
interface Face {
  id: Id;
  plane: PlaneFrame;
  outerLoopId: Id;
  innerLoopIds: Id[];
  frontMaterialId: Id;
  backMaterialId: Id;
}
interface FaceUse {
  faceId: Id;
  orientation: 1 | -1;
}
interface Shell {
  id: Id;
  faces: FaceUse[];
}
interface Body {
  id: Id;
  vertexIds: Id[];
  edgeIds: Id[];
  faceIds: Id[];
  shellIds: Id[];
  // 'solid' НЕ хранится как непроверенный пользовательский флаг
}
interface GeometryModel {
  id: Id;
  ownerDefinitionId: Id;
  representation: "planar-topology";
  vertices: Table<Vertex>;
  edges: Table<Edge>;
  coedges: Table<Coedge>;
  loops: Table<Loop>;
  faces: Table<Face>;
  shells: Table<Shell>;
  bodies: Table<Body>;
}
interface Definition {
  id: Id;
  name: string;
  kind: "scene" | "group" | "component";
  geometryId: Id | null;
  childNodeIds: Id[];
}
interface NodeBase {
  id: Id;
  name: string;
  parentDefinitionId: Id;
  transform: PlacementTransform;
  visible: boolean;
  locked: boolean;
}
type Node = NodeBase &
  (
    | { kind: "group" | "component"; definitionId: Id }
    | {
        kind: "legacy-primitive";
        primitive: {
          kind: "cube" | "sphere" | "cylinder" | "plane";
          size: number;
          materialId: Id;
        };
        legacyParentId?: Id;
      }
  );
interface Material {
  id: Id;
  color: string;
  roughness: number;
  metalness: number;
}
interface EntityRef {
  definitionId: Id;
  geometryId: Id;
  kind: EntityKind;
  entityId: Id;
  occurrencePath: Id[]; // placements от root до редактируемого definition
}
interface GeometryPolicy {
  version: 1;
  absoluteDistance: number;
  relativeDistance: number;
  angular: number;
  maxTransformCondition: number;
}
interface ProjectV2 {
  format: "forma";
  schemaVersion: 2;
  name: string;
  units: "m" | "cm" | "mm";
  rootDefinitionId: Id;
  definitions: Table<Definition>;
  nodes: Table<Node>;
  geometries: Table<GeometryModel>;
  materials: Table<Material>;
  geometryPolicy: GeometryPolicy;
  camera: {
    position: Vec3;
    target: Vec3;
    projection: "perspective" | "orthographic";
    zoom: number;
  };
  references: Table<{ id: Id; target: EntityRef }>;
  provenance: LineageEntry[]; // только нужные для живых references цепочки
  extensions: Record<string, unknown>; // namespaced необязательные данные
}
interface LineageEntry {
  operationId: Id;
  kind: EntityKind;
  retiredId: Id;
  descendants: { id: Id; parameterRange?: [number, number] }[];
  reason: "split" | "merge" | "delete" | "convert";
}
```

Ссылки из Table проверяются по типу, а не просто на существование строки. Один legacy primitive node соответствует объекту v1 с тем же ID. Materials получают детерминированные IDs при миграции. Definition/Geometry IDs миграции вычисляются в выделенном namespace из исходных IDs; повторная миграция одного файла даёт то же содержимое без timestamps и новых случайных IDs.

`parentDefinitionId` и `childNodeIds` проверяются на взаимное соответствие. Избыточные списки Body и Shell — валидируемые данные для устойчивых IDs; adjacency/search — производные кеши, не дополнительные несогласованные таблицы. Открытые грани могут не входить в замкнутую оболочку. У Body с изолированными рёбрами допускается пустой shellIds. Ненужные orphan coedges/loops запрещены; свободные рёбра и явно сохранённые construction vertices не являются ошибкой.

Будущий B-Rep добавляется **новым вариантом discriminated union GeometryAsset**, например `representation:'occt-brep'`, engine/build version и сериализованный payload. Нельзя без миграции вставить opaque WASM pointer в GeometryModel или тихо объявить новый representation совместимым с v2.0 reader.

## Транзакции и происхождение

```ts
interface Patch<T extends { id: Id }> {
  upsert: T[];
  delete: Id[];
}
interface GeometryPatch {
  geometryId: Id;
  vertices: Patch<Vertex>;
  edges: Patch<Edge>;
  coedges: Patch<Coedge>;
  loops: Patch<Loop>;
  faces: Patch<Face>;
  shells: Patch<Shell>;
  bodies: Patch<Body>;
}
interface DocumentDelta {
  geometryPatches: GeometryPatch[];
  createGeometries: GeometryModel[];
  deleteGeometries: Id[];
  definitions: Patch<Definition>;
  nodes: Patch<Node>;
  materials: Patch<Material>;
  references: Patch<{ id: Id; target: EntityRef }>;
  provenance: { append: LineageEntry[]; removeOperationIds: Id[] };
  properties?: { name?: string; units?: "m" | "cm" | "mm" };
}
interface PreparedChange {
  operationId: Id;
  label: string;
  sessionId: Id;
  baseRevision: number;
  forward: DocumentDelta;
  inverse: DocumentDelta;
  beforeContentToken: Id;
  afterContentToken: Id;
  affectedGeometryIds: Id[];
  diagnostics: Diagnostic[];
}
interface Diagnostic {
  code:
    | "DEGENERATE"
    | "NON_PLANAR"
    | "NUMERICAL_AMBIGUITY"
    | "STALE_REVISION"
    | "LOCKED"
    | "UNSUPPORTED_OPERATION"
    | "INVALID_TOPOLOGY"
    | "RESOURCE_LIMIT";
  message: string;
  refs: EntityRef[];
}
type ResolveResult =
  | { status: "exact" | "descendant"; ref: EntityRef }
  | { status: "ambiguous"; candidates: EntityRef[] }
  | { status: "deleted" };
```

Inverse хранит удалённые и прежние изменённые сущности целиком, не восстанавливает их из Mesh и не пересчитывает IDs. GeometryPatch запрещает пересекающиеся create/delete одного ID в одном конечном состоянии; before/preconditions проверяются перед применением. Создание geometry и её topology задаётся либо createGeometries, либо patch существующей, не обоими путями одновременно. Material/definition GC выполняется отдельной обратимой частью транзакции, а не фоновым удалением ещё используемых ресурсов.

## Worker transport и отображение

```ts
interface Envelope {
  protocolVersion: 1;
  sessionId: Id;
  requestId: Id;
  operationId: Id;
  baseRevision: number;
  geometryPolicyVersion: 1;
}
type SketchIntent =
  | {
      kind: "insert-segments";
      geometryId: Id;
      segments: [Vec3, Vec3][];
      plane: PlaneFrame | null;
    }
  | {
      kind: "move-vertices";
      geometryId: Id;
      positions: { vertexId: Id; position: Vec3 }[];
    }
  | {
      kind: "delete-entities";
      refs: EntityRef[];
      mode: "face-only" | "with-dependent-faces";
    }
  | { kind: "make-face"; geometryId: Id; boundaryEdgeIds: Id[] };
type WorkerRequest = Envelope &
  (
    | { type: "propose"; intent: SketchIntent; mode: "preview" | "commit" }
    | { type: "sync"; models: GeometryModel[]; policy: GeometryPolicy }
    | { type: "ack"; newRevision: number; acceptedOperationId: Id }
    | { type: "cancel"; cancelRequestId: Id }
  );
interface TopologyProposal {
  patches: GeometryPatch[];
  inversePatches: GeometryPatch[];
  lineage: LineageEntry[];
  affectedGeometryIds: Id[];
}
type WorkerResponse = Envelope &
  (
    | { type: "result"; proposal: TopologyProposal; render: RenderMeshDTO[] }
    | { type: "preview"; render: RenderMeshDTO[]; diagnostics: Diagnostic[] }
    | { type: "error"; diagnostics: Diagnostic[] }
    | { type: "synced" | "cancelled" }
  );
interface RenderMeshDTO {
  geometryId: Id;
  renderRevision: number;
  localOrigin: Vec3;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  faceIds: Id[];
  triangleToFace: Uint32Array;
  edgeIds: Id[];
  edgePositions: Float32Array;
  segmentToEdge: Uint32Array;
  vertexIds: Id[];
  vertexPositions: Float32Array;
  materialGroups: { start: number; count: number; materialId: Id }[];
}
```

Это схема обмена: для commit отдельно нужны bootstrap/синхронизация и ack/reject; типы generation/session обязательны даже при последовательных запросах. Table, GeometryPolicy и topology остаются вне Three.js. Editor оборачивает TopologyProposal в полный PreparedChange, добавляя document properties/создание контекста при необходимости. Preview не имеет inverse и не принимает commit в обход coordinator.

Renderer создаёт BufferGeometry из DTO и хранит mapping только вместе с renderRevision. Проверяются длины arrays, конечность чисел, диапазоны indices/mapping/material groups, лимиты ресурсов. Некорректный DTO отвергается, предыдущая сцена остаётся. Координаты GPU смещены относительно localOrigin; EntityId при переносе buffers не теряются.

## Инструменты, привязки и файлы

```ts
interface SnapCandidate {
  kind:
    | "endpoint"
    | "intersection"
    | "midpoint"
    | "on-edge"
    | "on-face"
    | "axis"
    | "grid";
  pointWorld: Vec3;
  screenDistancePx: number;
  priority: number;
  sourceRefs: EntityRef[];
  revision: number;
}
interface ResolvedInput {
  pointWorld: Vec3;
  pointLocal: Vec3;
  workingPlane: PlaneFrame;
  snap: SnapCandidate | null;
  lockedAxis: "x" | "y" | "z" | null;
  dimensionMetres: number | null;
  valid: boolean;
  diagnostics: Diagnostic[];
}
type SaveResult =
  | { status: "saved"; contentToken: Id; viewToken: Id; destinationToken: Id }
  | { status: "download-started"; contentToken: Id; viewToken: Id }
  | { status: "cancelled" }
  | { status: "error"; message: string };
interface OpenCandidate {
  operationId: Id;
  candidateToken: Id;
  bytes: Uint8Array;
}
```

FSM инструментов и FileService получают эти данные через порты. ОС-путь не хранится в проекте или Worker-запросах. Нативный candidateToken подтверждается только после validation/migration; при cancel/error прежний destinationToken остаётся прежним.

## Реализация S2

Исходный проект выше остаётся целевым контрактом полного v2. Реализованное подмножество и уточнённые имена находятся в packages/geometry/src; см. [S2_REPORT.md](S2_REPORT.md). GeometryDelta хранит before/after, inverse выводится и проверяется автоматически; GeometrySession — harness одной модели, GeometryCatalog — внутренний граф контекстов. ProjectV2/полный DocumentDelta/Worker/render DTO ещё не подключены к production. Это не готовность файлового формата v2.
