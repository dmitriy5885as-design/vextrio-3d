import { expect, it } from "vitest";
import * as THREE from "three";
import {
  validateProject,
  occurrenceMatrix,
  type ProjectV2,
} from "@forma/document";
import {
  id,
  transformAffine,
  inverseAffine,
  validateAffine,
  tessellateFace,
  canonical,
} from "@forma/geometry";
import { useEditor } from "@forma/editor";
import { TopologyBridge } from "../packages/viewport/src/TopologyBridge";
import {
  componentProject,
  topologyProject,
  firstRef,
} from "./fixtures/v2-project";
function sheared() {
  const p = componentProject(),
    a = p.nodes["instance/group"],
    b = p.nodes["instance/one"];
  if (a.kind === "legacy-primitive" || b.kind === "legacy-primitive")
    throw Error("native fixture");
  a.transform.rotation = [0, 0, Math.sin(Math.PI / 8), Math.cos(Math.PI / 8)];
  a.transform.scale = [2, 1, 1];
  b.transform.rotation = [
    0,
    0,
    Math.sin(-Math.PI / 12),
    Math.cos(-Math.PI / 12),
  ];
  b.transform.scale = [1, 1.5, 1];
  return p;
}
it("composes a full occurrence path with shear identically to Three.js, without importing it into core", () => {
  const p = sheared(),
    matrix = occurrenceMatrix(p, ["instance/group", "instance/one"]),
    reference = new THREE.Matrix4();
  for (const key of ["instance/group", "instance/one"]) {
    const n = p.nodes[key];
    if (n.kind === "legacy-primitive") throw Error("native");
    reference.multiply(
      new THREE.Matrix4().compose(
        new THREE.Vector3(...n.transform.translation),
        new THREE.Quaternion(...n.transform.rotation),
        new THREE.Vector3(...n.transform.scale),
      ),
    );
  }
  matrix.forEach((n, i) => expect(n).toBeCloseTo(reference.elements[i], 12));
  const point: [number, number, number] = [3, 1.5, 0],
    world = transformAffine(point, matrix),
    back = transformAffine(world, inverseAffine(matrix));
  back.forEach((n, i) => expect(n).toBeCloseTo(point[i], 12));
});
it("edits shared topology through a sheared occurrence and restores both placements with one Undo", async () => {
  const p = sheared();
  validateProject(p);
  useEditor.getState().replace(p);
  const ref = {
    ...firstRef(p),
    occurrencePath: ["instance/group", "instance/one"],
  };
  expect(
    (
      await useEditor.getState().editGeometry(ref, {
        kind: "delete-entities",
        entityIds: [ref.entityId],
      })
    ).status,
  ).toBe("applied");
  const after = useEditor.getState().project as ProjectV2;
  expect(Object.keys(after.geometries[ref.geometryId].faces)).toHaveLength(0);
  expect(after.nodes).toEqual(p.nodes);
  useEditor.getState().undo();
  expect(useEditor.getState().project).toEqual(p);
});
it("rejects composed ill-conditioning even when each individual TRS is valid", () => {
  const p = componentProject();
  p.nodes["instance/group"].transform.scale = [1e5, 1, 1];
  p.nodes["instance/one"].transform.scale = [1e5, 1, 1];
  expect(() => validateProject(p)).toThrow(/condition/);
});
it.each([
  { matrix: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1] },
  { matrix: [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
])("rejects singular and mirrored affine matrices", ({ matrix }) => {
  expect(() => validateAffine(matrix)).toThrow();
});
it("ray picking sees an actual hole and maps rendered primitives to canonical IDs from either side", () => {
  const p = topologyProject(),
    bridge = new TopologyBridge(p, 7);
  bridge.root.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(),
    pick = (
      point: [number, number, number],
      direction: [number, number, number] = [0, 0, -1],
    ) => {
      ray.set(new THREE.Vector3(...point), new THREE.Vector3(...direction));
      return bridge.pick(ray, 0.01);
    };
  const face = pick([3, 1.5, 10]);
  expect(face && "ref" in face && face.ref.kind).toBe("face");
  expect(pick([1.5, 1.5, 10])).toBe(null);
  const edge = pick([4, 1.5, 10]);
  expect(edge && "ref" in edge && edge.ref.kind).toBe("edge");
  const vertex = pick([4, 3, 10]);
  expect(vertex && "ref" in vertex && vertex.ref.kind).toBe("vertex");
  const back = pick([3, 1.5, -10], [0, 0, 1]);
  expect(back && "ref" in back && back.ref.entityId).toBe(
    face && "ref" in face ? face.ref.entityId : "",
  );
  bridge.dispose();
});
it("preserves front and back material IDs while tessellation remains derived", () => {
  const p = topologyProject(),
    g = Object.values(p.geometries)[0],
    face = Object.values(g.faces)[0];
  p.materials["native/back"] = {
    id: "native/back",
    color: "#ff0000",
    roughness: 0.5,
    metalness: 0,
  };
  face.backMaterialId = id("native/back");
  validateProject(p);
  const before = canonical(p),
    bridge = new TopologyBridge(p, 1),
    surfaces = bridge.pickables.filter(
      (o): o is THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> =>
        o instanceof THREE.Mesh,
    );
  expect(surfaces.map((m) => m.material.color.getHexString()).sort()).toEqual([
    "4dd5c0",
    "ff0000",
  ]);
  expect(tessellateFace(g, face).area).toBe(11);
  expect(canonical(p)).toBe(before);
  bridge.dispose();
});
it("rebases GPU positions at a double-precision local origin without flattening the saved geometry", () => {
  const p = topologyProject(),
    g = Object.values(p.geometries)[0];
  for (const v of Object.values(g.vertices))
    v.position = v.position.map((n, i) => (i < 2 ? n + 1e8 : n)) as [
      number,
      number,
      number,
    ];
  for (const face of Object.values(g.faces))
    face.plane.origin = face.plane.origin.map((n, i) =>
      i < 2 ? n + 1e8 : n,
    ) as [number, number, number];
  validateProject(p);
  const before = canonical(p),
    bridge = new TopologyBridge(p, 1);
  for (const o of bridge.pickables)
    if ("geometry" in o) {
      const a = (o.geometry as THREE.BufferGeometry).getAttribute("position");
      expect([...a.array].every((n) => Math.abs(n) <= 4)).toBe(true);
    }
  expect(canonical(p)).toBe(before);
  bridge.dispose();
});
it("does not pick hidden parent groups or reuse stale maps for another render revision", () => {
  const p = componentProject();
  p.nodes["instance/group"].visible = false;
  const bridge = new TopologyBridge(p, 20);
  bridge.root.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(
    new THREE.Vector3(-2, 1.5, 10),
    new THREE.Vector3(0, 0, -1),
  );
  expect(bridge.pick(ray, 0.01)).toBe(null);
  ray.set(new THREE.Vector3(8, 1.5, 10), new THREE.Vector3(0, 0, -1));
  expect(bridge.pick(ray, 0.01)).not.toBe(null);
  for (const o of bridge.pickables) o.userData.renderRevision = 19;
  expect(bridge.pick(ray, 0.01)).toBe(null);
  bridge.dispose();
});
