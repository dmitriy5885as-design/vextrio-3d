import { expect, it } from "vitest";
import {
  classifyBody,
  id,
  validateCatalog,
  validateGeometry,
  type GeometryCatalog,
  type InstanceNode,
} from "@forma/geometry";
import { topology, topologyContext, wire } from "./fixtures/topology";
function catalog(): GeometryCatalog {
  const m = wire();
  const instance = (key: string): InstanceNode => ({
    id: id(key),
    name: key,
    parentDefinitionId: id("root"),
    definitionId: id("definition/test"),
    kind: "component",
    transform: {
      translation: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    },
    visible: true,
    locked: false,
  });
  return {
    rootDefinitionId: id("root"),
    materialIds: [id("material/default")],
    definitions: {
      root: {
        id: id("root"),
        name: "Scene",
        kind: "scene",
        geometryId: null,
        childNodeIds: [id("node/1"), id("node/2")],
      },
      "definition/test": {
        id: id("definition/test"),
        name: "Shared",
        kind: "component",
        geometryId: m.id,
        childNodeIds: [],
      },
    },
    nodes: { "node/1": instance("node/1"), "node/2": instance("node/2") },
    geometries: { [m.id]: m },
  };
}
it("permits shared component geometry with independent placements", () => {
  const c = catalog();
  c.nodes["node/2"].transform.translation = [10, 0, 0];
  expect(() => validateCatalog(c)).not.toThrow();
  expect(c.geometries["geometry/test"].vertices["v/0"].position).toEqual([
    0, 0, 0,
  ]);
});
it("rejects a shared group definition", () => {
  const c = catalog();
  c.definitions["definition/test"].kind = "group";
  Object.values(c.nodes).forEach((n) => (n.kind = "group"));
  expect(() => validateCatalog(c)).toThrow(/exactly one/);
});
it("checks node list/parent ownership and unique IDs across contexts", () => {
  const c = catalog();
  c.nodes["node/1"].parentDefinitionId = id("missing");
  expect(() => validateCatalog(c)).toThrow(/ownership/);
  const d = catalog();
  d.materialIds.push(id("v/0"));
  expect(() => validateCatalog(d)).toThrow(/ID/);
});
it("rejects cyclic definition graphs", () => {
  const c = catalog();
  c.definitions["definition/test"].childNodeIds.push(id("node/3"));
  c.nodes["node/3"] = {
    ...structuredClone(c.nodes["node/1"]),
    id: id("node/3"),
    parentDefinitionId: id("definition/test"),
  };
  expect(() => validateCatalog(c)).toThrow(/Cyclic/);
});
it("rejects dangling geometry ownership and invalid placement transforms", () => {
  const c = catalog();
  c.geometries["geometry/test"].ownerDefinitionId = id("other");
  expect(() => validateCatalog(c)).toThrow(/ownership/);
  const d = catalog();
  d.nodes["node/1"].transform.scale[1] = 0;
  expect(() => validateCatalog(d)).toThrow(/placement/);
});
function hole() {
  const m = topology(
    [
      [0, 0, 0],
      [4, 0, 0],
      [4, 0, 4],
      [0, 0, 4],
      [1, 0, 1],
      [1, 0, 2],
      [2, 0, 2],
      [2, 0, 1],
    ],
    [
      [0, 1, 2, 3],
      [4, 5, 6, 7],
    ],
  );
  delete m.faces["f/1"];
  m.faces["f/0"].innerLoopIds = [id("l/1")];
  m.bodies["body/0"].faceIds = [id("f/0")];
  return m;
}
it("classifies a disconnected vertex fan as non-manifold", () => {
  const m = topology(
    [
      [0, 0, 0],
      [2, 0, 0],
      [0, 2, 0],
      [-2, 0, 0],
      [0, -2, 0],
    ],
    [
      [0, 1, 2],
      [0, 3, 4],
    ],
  );
  validateGeometry(m, topologyContext);
  expect(classifyBody(m, "body/0")).toBe("non-manifold");
});
it("measures topology tolerances in world metres under a nonuniform placement", () => {
  const m = wire();
  m.vertices["v/1"].position = [1e-8, 0, 0];
  const placement = {
    translation: [0, 0, 0] as [number, number, number],
    rotation: [0, 0, 0, 1] as [number, number, number, number],
    scale: [100, 1, 1] as [number, number, number],
  };
  expect(() => validateGeometry(m, topologyContext)).toThrow(/short edge/);
  expect(() =>
    validateGeometry(m, { ...topologyContext, placement }),
  ).not.toThrow();
  const face = topology(
    [
      [0, 0, 0],
      [2, 0, 0],
      [2, 2, 2],
      [0, 2, 2],
    ],
    [[0, 1, 2, 3]],
  );
  expect(() =>
    validateGeometry(face, { ...topologyContext, placement }),
  ).not.toThrow();
});
it("accepts a face with a hole as one connected body through face incidence", () => {
  expect(() => validateGeometry(hole(), topologyContext)).not.toThrow();
});
it("rejects a hole outside or touching its outer contour", () => {
  const m = hole();
  for (const key of ["v/4", "v/5", "v/6", "v/7"])
    m.vertices[key].position[0] += 10;
  expect(() => validateGeometry(m, topologyContext)).toThrow(/outside/);
  const n = hole();
  n.vertices["v/4"].position[0] = 0;
  n.vertices["v/5"].position[0] = 0;
  expect(() => validateGeometry(n, topologyContext)).toThrow(/boundaries/);
});
it("rejects reversed hole winding", () => {
  const m = hole(),
    l = m.loops["l/1"];
  l.coedgeIds.reverse();
  l.coedgeIds.forEach(
    (c) => (m.coedges[c].direction = m.coedges[c].direction === 1 ? -1 : 1),
  );
  expect(() => validateGeometry(m, topologyContext)).toThrow(/winding/);
});
