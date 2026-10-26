import {
  clone,
  type Project as ProjectV1,
  type SceneObject,
  type Transform,
  type CameraData,
} from "@forma/shared";
import {
  id,
  entityTables,
  defaultPolicy,
  validateCatalog,
  validateGeometry,
  tessellateFace,
  type Definition,
  type InstanceNode,
  type GeometryModel,
  type GeometryPolicy,
  type EntityKind,
  type LineageEntry,
} from "@forma/geometry";
import {
  assertJsonData,
  validateProjectV1,
  MAX_PROJECT_BYTES,
} from "./validation";
import {
  identityMatrix,
  multiplyMatrices,
  placementMatrix,
  validateAffine,
} from "@forma/geometry";
export type { ProjectV1 };
export interface Material {
  id: string;
  color: string;
  roughness: number;
  metalness: number;
  userData?: Record<string, unknown>;
}
export interface LegacyNode {
  id: string;
  name: string;
  kind: "legacy-primitive";
  parentDefinitionId: string;
  transform: Transform;
  visible: boolean;
  locked: boolean;
  primitive: SceneObject["geometry"];
  materialId: string;
  legacyParentId: string | null;
  extensions: Record<string, unknown>;
}
export type DocumentNode = InstanceNode | LegacyNode;
export interface EntityRef {
  definitionId: string;
  geometryId: string;
  kind: EntityKind;
  entityId: string;
  occurrencePath: string[];
}
export interface DocumentLineage extends LineageEntry {
  geometryId: string;
}
export interface ProjectV2 {
  format: "forma";
  schemaVersion: 2;
  name: string;
  units: ProjectV1["units"];
  camera: CameraData;
  rootDefinitionId: string;
  definitions: Record<string, Definition>;
  nodes: Record<string, DocumentNode>;
  geometries: Record<string, GeometryModel>;
  materials: Record<string, Material>;
  geometryPolicy: GeometryPolicy;
  references: Record<string, { id: string; target: EntityRef }>;
  provenance: DocumentLineage[];
  extensions: Record<string, unknown>;
}
export type Document = ProjectV1 | ProjectV2;
export const identityPlacement = () => ({
  translation: [0, 0, 0] as [number, number, number],
  rotation: [0, 0, 0, 1] as [number, number, number, number],
  scale: [1, 1, 1] as [number, number, number],
});
const extras = (value: object, known: string[]) =>
  Object.fromEntries(Object.entries(value).filter(([k]) => !known.includes(k)));
const materialView = (m: Material): SceneObject["material"] => ({
  ...clone(m.userData ?? {}),
  color: m.color,
  roughness: m.roughness,
  metalness: m.metalness,
});
export function getLegacyObjects(p: Document): SceneObject[] {
  if (p.schemaVersion === 1) return p.objects;
  return Object.values(p.nodes)
    .filter((n): n is LegacyNode => n.kind === "legacy-primitive")
    .map((n) => ({
      ...clone(n.extensions),
      id: n.id,
      name: n.name,
      type: n.primitive.kind,
      transform: clone(n.transform),
      geometry: clone(n.primitive),
      material: materialView(p.materials[n.materialId]),
      visible: n.visible,
      locked: n.locked,
      parentId: n.legacyParentId,
    }));
}
export function legacyView(p: Document): ProjectV1 {
  return p.schemaVersion === 1
    ? p
    : {
        ...clone((p.extensions.legacyFields ?? {}) as object),
        schemaVersion: 1,
        name: p.name,
        units: p.units,
        camera: clone(p.camera),
        objects: getLegacyObjects(p),
      };
}
export function documentIds(p: ProjectV2) {
  return new Set([
    p.rootDefinitionId,
    ...Object.keys(p.definitions),
    ...Object.keys(p.nodes),
    ...Object.keys(p.materials),
    ...Object.keys(p.references),
    ...Object.keys(p.geometries),
    ...Object.values(p.geometries).flatMap((g) =>
      entityTables.flatMap((t) => Object.keys(g[t])),
    ),
    ...p.provenance.flatMap((l) => [
      l.operationId,
      l.retiredId,
      ...l.descendants.map((d) => d.id),
    ]),
  ]);
}
function available(used: Set<string>, prefix: string) {
  let candidate = prefix,
    i = 0;
  while (used.has(candidate)) candidate = prefix + "/" + ++i;
  used.add(candidate);
  return candidate;
}
function legacyNode(
  object: SceneObject,
  parent: string,
  materialId: string,
): LegacyNode {
  return {
    id: object.id,
    name: object.name,
    kind: "legacy-primitive",
    parentDefinitionId: parent,
    transform: clone(object.transform),
    primitive: clone(object.geometry),
    materialId,
    visible: object.visible,
    locked: object.locked,
    legacyParentId: object.parentId,
    extensions: extras(object, [
      "id",
      "name",
      "type",
      "transform",
      "geometry",
      "material",
      "visible",
      "locked",
      "parentId",
    ]),
  };
}
function makeMaterial(object: SceneObject, materialId: string): Material {
  return {
    id: materialId,
    color: object.material.color,
    roughness: object.material.roughness,
    metalness: object.material.metalness,
    userData: extras(object.material, ["color", "roughness", "metalness"]),
  };
}
export function migrateProject(p: Document): ProjectV2 {
  if (p.schemaVersion === 2) {
    validateProjectV2(p);
    return clone(p);
  }
  validateProjectV1(p);
  const used = new Set(p.objects.map((o) => o.id)),
    root = available(used, "v2/root");
  const result: ProjectV2 = {
    format: "forma",
    schemaVersion: 2,
    name: p.name,
    units: p.units,
    camera: clone(p.camera),
    rootDefinitionId: root,
    definitions: {
      [root]: {
        id: id(root),
        name: "Сцена",
        kind: "scene",
        geometryId: null,
        childNodeIds: p.objects.map((o) => o.id as InstanceNode["id"]),
      },
    },
    nodes: {},
    geometries: {},
    materials: {},
    geometryPolicy: { ...defaultPolicy },
    references: {},
    provenance: [],
    extensions: {
      legacyFields: extras(p, [
        "schemaVersion",
        "name",
        "units",
        "objects",
        "camera",
      ]),
    },
  };
  p.objects.forEach((object, i) => {
    const mid = available(used, `v2/material/${i}`);
    Object.defineProperty(result.nodes, object.id, {
      value: legacyNode(object, root, mid),
      enumerable: true,
      writable: true,
      configurable: true,
    });
    result.materials[mid] = makeMaterial(object, mid);
  });
  validateProjectV2(result);
  return result;
}
export function emptyProjectV2(name = "Без названия"): ProjectV2 {
  return migrateProject({
    schemaVersion: 1,
    name,
    units: "m",
    objects: [],
    camera: {
      position: [9, 7, 10],
      target: [0, 0, 0],
      projection: "perspective",
      zoom: 1,
    },
  });
}
// The compatibility view is computed, never stored alongside canonical nodes.
export function mutateLegacy(
  p: Document,
  fn: (candidate: ProjectV1) => unknown,
) {
  if (p.schemaVersion === 1) return fn(p);
  const view = legacyView(p),
    old = new Map(getLegacyObjects(p).map((o) => [o.id, o])),
    result = fn(view);
  if (result && typeof result === "object" && "then" in result) {
    void Promise.resolve(result).catch(() => {});
    throw Error("Изменение документа должно быть синхронным.");
  }
  validateProjectV1(view);
  const used = documentIds(p),
    previous = new Map(
      Object.values(p.nodes)
        .filter((n): n is LegacyNode => n.kind === "legacy-primitive")
        .map((n) => [n.id, n]),
    );
  const order = new Map(
    Object.values(p.definitions).map((d) => [d.id, [...d.childNodeIds]]),
  );
  const retainedIds = new Set(view.objects.map((o) => o.id));
  for (const [key] of previous) if (!retainedIds.has(key)) delete p.nodes[key];
  for (const def of Object.values(p.definitions))
    def.childNodeIds = def.childNodeIds.filter((k) => !previous.has(k));
  for (const object of view.objects) {
    const before = previous.get(object.id),
      parent = before?.parentDefinitionId ?? p.rootDefinitionId;
    let mid = before?.materialId;
    if (
      !mid ||
      JSON.stringify(old.get(object.id)?.material) !==
        JSON.stringify(object.material)
    ) {
      mid = available(used, `material/${crypto.randomUUID()}`);
      p.materials[mid] = {
        ...(before ? clone(p.materials[before.materialId]) : {}),
        ...makeMaterial(object, mid),
      };
    }
    Object.defineProperty(p.nodes, object.id, {
      value: {
        ...(before ? clone(before) : {}),
        ...legacyNode(object, parent, mid),
      },
      enumerable: true,
      writable: true,
      configurable: true,
    });
    p.definitions[parent].childNodeIds.push(object.id as InstanceNode["id"]);
  }
  for (const d of Object.values(p.definitions)) {
    const old = order.get(d.id) ?? [];
    d.childNodeIds.sort((a, b) => {
      const ai = old.indexOf(a),
        bi = old.indexOf(b);
      return (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi);
    });
  }
  p.name = view.name;
  p.units = view.units;
  p.camera = clone(view.camera);
  const fields = extras(view, [
    "schemaVersion",
    "name",
    "units",
    "objects",
    "camera",
  ]);
  if (Object.keys(fields).length || Object.hasOwn(p.extensions, "legacyFields"))
    p.extensions.legacyFields = fields;
  return result;
}
export function definitionAtPath(p: ProjectV2, path: string[]) {
  let current = p.rootDefinitionId;
  for (const key of path) {
    const n = p.nodes[key];
    if (!n || n.kind === "legacy-primitive" || n.parentDefinitionId !== current)
      throw Error("Неверный путь экземпляра.");
    current = n.definitionId;
  }
  return current;
}
export function occurrenceMatrix(p: ProjectV2, path: string[]) {
  definitionAtPath(p, path);
  let matrix = identityMatrix();
  for (const key of path) {
    const n = p.nodes[key];
    if (n.kind === "legacy-primitive") throw Error("Неверное размещение.");
    matrix = multiplyMatrices(matrix, placementMatrix(n.transform));
  }
  validateAffine(matrix, p.geometryPolicy);
  return matrix;
}
export function definitionOccurrences(p: ProjectV2) {
  const result: {
      definitionId: string;
      path: string[];
      visible: boolean;
      locked: boolean;
      worldTransform: number[];
    }[] = [],
    queue = [
      {
        definitionId: p.rootDefinitionId,
        path: [] as string[],
        visible: true,
        locked: false,
        worldTransform: identityMatrix(),
      },
    ];
  let count = 0;
  while (queue.length) {
    const item = queue.pop()!;
    if (item.path.length > 128 || ++count > 100000)
      throw Error("Превышен лимит экземпляров.");
    validateAffine(item.worldTransform, p.geometryPolicy);
    result.push(item);
    for (const key of p.definitions[item.definitionId].childNodeIds) {
      if (++count > 100000) throw Error("Превышен лимит экземпляров.");
      const n = p.nodes[key];
      if (n.kind !== "legacy-primitive")
        queue.push({
          definitionId: n.definitionId,
          path: [...item.path, key],
          visible: item.visible && n.visible,
          locked: item.locked || n.locked,
          worldTransform: multiplyMatrices(
            item.worldTransform,
            placementMatrix(n.transform),
          ),
        });
    }
  }
  return result;
}

export function validateEntityRef(
  p: ProjectV2,
  ref: EntityRef,
  allowRetired = false,
) {
  if (
    !ref ||
    typeof ref.entityId !== "string" ||
    typeof ref.definitionId !== "string" ||
    typeof ref.geometryId !== "string" ||
    !Array.isArray(ref.occurrencePath) ||
    ref.occurrencePath.some((k) => typeof k !== "string") ||
    ref.occurrencePath.length > 128 ||
    definitionAtPath(p, ref.occurrencePath) !== ref.definitionId ||
    p.definitions[ref.definitionId]?.geometryId !== ref.geometryId
  )
    throw Error("Неверный контекст геометрической ссылки.");
  const table = (
    {
      vertex: "vertices",
      edge: "edges",
      coedge: "coedges",
      loop: "loops",
      face: "faces",
      shell: "shells",
      body: "bodies",
    } as const
  )[ref.kind];
  if (
    !table ||
    !p.geometries[ref.geometryId] ||
    (!Object.hasOwn(p.geometries[ref.geometryId][table], ref.entityId) &&
      !(
        allowRetired &&
        p.provenance.some(
          (l) =>
            l.geometryId === ref.geometryId &&
            l.kind === ref.kind &&
            l.retiredId === ref.entityId,
        )
      ))
  )
    throw Error("Геометрическая сущность не найдена.");
}
export function geometryContext(
  p: ProjectV2,
  geometryId: string,
  reserveRetired = true,
  path?: string[],
) {
  const g = p.geometries[geometryId];
  if (!g) throw Error("Геометрия не найдена.");
  const own = new Set([
    g.id,
    g.ownerDefinitionId,
    ...entityTables.flatMap((t) => Object.keys(g[t])),
  ]);
  const reserved = reserveRetired
    ? documentIds(p)
    : new Set([
        ...Object.keys(p.nodes),
        ...Object.keys(p.definitions),
        ...Object.keys(p.materials),
        ...Object.keys(p.geometries),
        ...Object.values(p.geometries)
          .filter((x) => x.id !== g.id)
          .flatMap((x) => entityTables.flatMap((t) => Object.keys(x[t]))),
      ]);
  return {
    ownerDefinitionId: g.ownerDefinitionId,
    materialIds: new Set(Object.keys(p.materials)),
    reservedIds: new Set([...reserved].filter((k) => !own.has(k))),
    policy: p.geometryPolicy,
    ...(path ? { worldTransform: occurrenceMatrix(p, path) } : {}),
  };
}
export function validateProjectV2(value: unknown): asserts value is ProjectV2 {
  assertJsonData(value);
  const p = value as ProjectV2;
  if (
    !p ||
    p.schemaVersion !== 2 ||
    p.format !== "forma" ||
    !p.nodes ||
    !p.definitions ||
    !p.geometries ||
    !p.materials ||
    !p.extensions ||
    typeof p.extensions !== "object" ||
    Array.isArray(p.extensions) ||
    !p.references ||
    !Array.isArray(p.provenance)
  )
    throw Error("Неподдерживаемый документ VEXTRIO 3D v2.");
  if (
    Object.hasOwn(p.extensions, "legacyFields") &&
    (!p.extensions.legacyFields ||
      typeof p.extensions.legacyFields !== "object" ||
      Array.isArray(p.extensions.legacyFields))
  )
    throw Error("Неверные пользовательские данные старого документа.");
  validateProjectV1({
    schemaVersion: 1,
    name: p.name,
    units: p.units,
    camera: p.camera,
    objects: [],
  });
  for (const table of [
    p.nodes,
    p.definitions,
    p.geometries,
    p.materials,
    p.references,
  ])
    if (!table || typeof table !== "object" || Array.isArray(table))
      throw Error("Ожидается таблица сущностей.");
  const ids = new Set<string>();
  const claim = (key: string, entity: { id: string }) => {
    if (
      typeof key !== "string" ||
      !key.length ||
      entity.id !== key ||
      ids.has(key)
    )
      throw Error("Повторяющийся или неверный ID документа.");
    ids.add(key);
  };
  for (const table of [
    p.definitions,
    p.nodes,
    p.materials,
    p.geometries,
    p.references,
  ])
    for (const [key, e] of Object.entries(table)) claim(key, e);
  for (const g of Object.values(p.geometries))
    for (const t of entityTables)
      for (const [key, e] of Object.entries(g[t])) claim(key, e);
  const objects = getLegacyObjects(p);
  validateProjectV1({
    schemaVersion: 1,
    name: p.name,
    units: p.units,
    camera: p.camera,
    objects,
  });
  for (const m of Object.values(p.materials))
    validateProjectV1({
      schemaVersion: 1,
      name: p.name,
      units: p.units,
      camera: p.camera,
      objects: [
        {
          id: "material-check",
          name: "material",
          type: "cube",
          geometry: { kind: "cube", size: 1 },
          material: materialView(m),
          transform: {
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          },
          visible: true,
          locked: false,
          parentId: null,
        },
      ],
    });
  const legacy = new Set(
    Object.values(p.nodes)
      .filter((n) => n.kind === "legacy-primitive")
      .map((n) => n.id),
  );
  const definitions = Object.fromEntries(
    Object.entries(p.definitions).map(([k, d]) => [
      k,
      { ...d, childNodeIds: d.childNodeIds.filter((n) => !legacy.has(n)) },
    ]),
  );
  validateCatalog(
    {
      rootDefinitionId: id(p.rootDefinitionId),
      definitions,
      nodes: Object.fromEntries(
        Object.entries(p.nodes).filter(
          ([, n]) => n.kind !== "legacy-primitive",
        ),
      ) as Record<string, InstanceNode>,
      geometries: p.geometries,
      materialIds: Object.keys(p.materials).map((k) => id(k)),
    },
    p.geometryPolicy,
  );
  const listed = new Set<string>();
  for (const d of Object.values(p.definitions))
    for (const key of d.childNodeIds) {
      if (
        listed.has(key) ||
        !p.nodes[key] ||
        p.nodes[key].parentDefinitionId !== d.id
      )
        throw Error("Неверное владение узлом.");
      listed.add(key);
    }
  if (listed.size !== Object.keys(p.nodes).length)
    throw Error("Узел без определения.");
  for (const n of Object.values(p.nodes))
    if (n.kind === "legacy-primitive") {
      if (
        !p.materials[n.materialId] ||
        !n.extensions ||
        typeof n.extensions !== "object" ||
        Array.isArray(n.extensions)
      )
        throw Error("Неверный legacy-узел.");
    }
  for (const m of Object.values(p.materials))
    if (
      m.userData !== undefined &&
      (!m.userData ||
        typeof m.userData !== "object" ||
        Array.isArray(m.userData))
    )
      throw Error("Неверные пользовательские данные материала.");
  // Bound expanded instances, not only the shared definition DAG.
  const occurrences = definitionOccurrences(p);
  for (const occurrence of occurrences) {
    const gid = p.definitions[occurrence.definitionId].geometryId;
    if (gid)
      validateGeometry(p.geometries[gid], {
        ownerDefinitionId: occurrence.definitionId,
        materialIds: new Set(Object.keys(p.materials)),
        policy: p.geometryPolicy,
        worldTransform: occurrence.worldTransform,
      });
  }
  for (const [key, r] of Object.entries(p.references)) {
    if (key !== r.id) throw Error("Неверный ID ссылки.");
    validateEntityRef(p, r.target, true);
  }
  const retired = new Map<string, DocumentLineage>();
  for (const l of p.provenance) {
    if (
      !p.geometries[l.geometryId] ||
      !["vertex", "edge", "coedge", "loop", "face", "shell", "body"].includes(
        l.kind,
      ) ||
      typeof l.operationId !== "string" ||
      !l.operationId.length ||
      !Array.isArray(l.descendants) ||
      !["split", "merge", "convert", "delete"].includes(l.reason) ||
      typeof l.retiredId !== "string" ||
      !l.retiredId.length ||
      retired.has(l.retiredId) ||
      ids.has(l.retiredId)
    )
      throw Error("Неверная provenance.");
    retired.set(l.retiredId, l);
    if (
      (l.reason === "delete" && l.descendants.length) ||
      (l.reason === "split" && l.descendants.length < 2) ||
      (l.reason !== "delete" && !l.descendants.length) ||
      new Set(l.descendants.map((d) => d.id)).size !== l.descendants.length
    )
      throw Error("Неверная мощность lineage.");
    for (const d of l.descendants)
      if (
        typeof d.id !== "string" ||
        d.id === l.retiredId ||
        (d.parameterRange &&
          (d.parameterRange.length !== 2 ||
            !d.parameterRange.every(Number.isFinite) ||
            d.parameterRange[0] < 0 ||
            d.parameterRange[1] > 1 ||
            d.parameterRange[0] >= d.parameterRange[1]))
      )
        throw Error("Неверный потомок provenance.");
  }
  const colors = new Map<string, 1 | 2>(),
    tables = {
      vertex: "vertices",
      edge: "edges",
      coedge: "coedges",
      loop: "loops",
      face: "faces",
      shell: "shells",
      body: "bodies",
    } as const;
  function walk(
    key: string,
    geometryId: string,
    kind: EntityKind,
    depth: number,
  ) {
    if (Object.hasOwn(p.geometries[geometryId][tables[kind]], key)) return;
    const l = retired.get(key);
    if (
      !l ||
      l.geometryId !== geometryId ||
      l.kind !== kind ||
      depth > 256 ||
      colors.get(key) === 1
    )
      throw Error("Повреждённая цепочка lineage.");
    if (colors.get(key) === 2) return;
    colors.set(key, 1);
    for (const d of l.descendants) walk(d.id, geometryId, kind, depth + 1);
    colors.set(key, 2);
  }
  for (const l of p.provenance) walk(l.retiredId, l.geometryId, l.kind, 0);
  const triangles = new Map<string, number>();
  for (const g of Object.values(p.geometries)) {
    let count = 0;
    for (const f of Object.values(g.faces))
      count += tessellateFace(g, f).indices.length / 3;
    triangles.set(g.id, count);
  }
  if (
    occurrences.reduce(
      (sum, o) =>
        sum +
        (triangles.get(p.definitions[o.definitionId].geometryId ?? "") ?? 0),
      0,
    ) > 1000000
  )
    throw Error("Превышен лимит отображаемых треугольников.");
  if (
    new TextEncoder().encode(JSON.stringify(p, null, 2)).length >
    MAX_PROJECT_BYTES
  )
    throw Error("Файл превышает допустимые 20 МБ.");
}
