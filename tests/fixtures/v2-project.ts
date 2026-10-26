import {
  emptyProjectV2,
  type ProjectV2,
  type EntityRef,
  serializeProject,
} from "@forma/document";
export function documentExamples() {
  return {
    hole: serializeProject(topologyProject()),
    components: serializeProject(componentProject()),
  };
}
import { id, prepareSketch, validatePrepared } from "@forma/geometry";
export function topologyProject(hole = true): ProjectV2 {
  const p = emptyProjectV2("Sketch v2");
  p.camera = {
    position: [7, 6, 10],
    target: [2, 1.5, 0],
    projection: "perspective",
    zoom: 1,
  };
  p.materials["native/material"] = {
    id: "native/material",
    color: "#4dd5c0",
    roughness: 0.6,
    metalness: 0.1,
  };
  let m: import("@forma/geometry").GeometryModel = {
    id: id<"geometry">("native/geometry"),
    ownerDefinitionId: id<"definition">(p.rootDefinitionId),
    representation: "planar-topology" as const,
    vertices: {},
    edges: {},
    coedges: {},
    loops: {},
    faces: {},
    shells: {},
    bodies: {},
  };
  const context = {
    ownerDefinitionId: p.rootDefinitionId,
    materialIds: new Set(Object.keys(p.materials)),
  };
  const segments: [
    import("@forma/geometry").Vec3,
    import("@forma/geometry").Vec3,
  ][] = [
    [
      [0, 0, 0],
      [4, 0, 0],
    ],
    [
      [4, 0, 0],
      [4, 3, 0],
    ],
    [
      [4, 3, 0],
      [0, 3, 0],
    ],
    [
      [0, 3, 0],
      [0, 0, 0],
    ],
    [
      [1, 1, 0],
      [2, 1, 0],
    ],
    [
      [2, 1, 0],
      [2, 2, 0],
    ],
    [
      [2, 2, 0],
      [1, 2, 0],
    ],
    [
      [1, 2, 0],
      [1, 1, 0],
    ],
  ];
  const change = prepareSketch(
    m,
    {
      kind: "insert-segments",
      segments: segments as [
        import("@forma/geometry").Vec3,
        import("@forma/geometry").Vec3,
      ][],
      plane: null,
    },
    context,
    id("fixture/insert"),
  );
  m = validatePrepared(m, change, context, id("fixture/insert"));
  if (hole) {
    const inner = Object.values(m.faces).find((f) => !f.innerLoopIds.length)!;
    const removal = prepareSketch(
      m,
      { kind: "delete-entities", entityIds: [inner.id] },
      context,
      id("fixture/hole"),
    );
    m = validatePrepared(m, removal, context, id("fixture/hole"));
  }
  p.geometries[m.id] = m;
  p.definitions[p.rootDefinitionId].geometryId = m.id;
  p.extensions["test:user"] = {
    note: "FORMA пользовательские данные",
    numbers: [1, 2, 3],
  };
  return p;
}
export function firstRef(
  p: ProjectV2,
  kind: EntityRef["kind"] = "face",
): EntityRef {
  const g = Object.values(p.geometries)[0],
    key = (
      {
        face: "faces",
        edge: "edges",
        vertex: "vertices",
        coedge: "coedges",
        loop: "loops",
        shell: "shells",
        body: "bodies",
      } as const
    )[kind];
  return {
    definitionId: g.ownerDefinitionId,
    geometryId: g.id,
    kind,
    entityId: Object.keys(g[key])[0],
    occurrencePath: [],
  };
}
export function componentProject() {
  const p = topologyProject(),
    root = p.definitions[p.rootDefinitionId],
    g = Object.values(p.geometries)[0],
    did = id<"definition">("definition/component"),
    group = id<"definition">("definition/group");
  root.geometryId = null;
  root.childNodeIds = [id("instance/group"), id("instance/two")];
  g.ownerDefinitionId = did;
  p.definitions[did] = {
    id: did,
    name: "Общий компонент",
    kind: "component",
    geometryId: g.id,
    childNodeIds: [],
  };
  p.definitions[group] = {
    id: group,
    name: "Группа",
    kind: "group",
    geometryId: null,
    childNodeIds: [id("instance/one")],
  };
  const t = (position: [number, number, number]) => ({
    translation: position,
    rotation: [0, 0, 0, 1] as [number, number, number, number],
    scale: [1, 1, 1] as [number, number, number],
  });
  p.nodes["instance/group"] = {
    id: id("instance/group"),
    name: "Группа слева",
    kind: "group",
    parentDefinitionId: id(p.rootDefinitionId),
    definitionId: group,
    transform: t([-5, 0, 0]),
    visible: true,
    locked: false,
  };
  p.nodes["instance/one"] = {
    id: id("instance/one"),
    name: "Компонент 1",
    kind: "component",
    parentDefinitionId: group,
    definitionId: did,
    transform: t([0, 0, 0]),
    visible: true,
    locked: false,
  };
  p.nodes["instance/two"] = {
    id: id("instance/two"),
    name: "Компонент 2",
    kind: "component",
    parentDefinitionId: id(p.rootDefinitionId),
    definitionId: did,
    transform: t([5, 0, 0]),
    visible: true,
    locked: false,
  };
  return p;
}
