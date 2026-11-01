import { componentProject } from "./fixtures/v2-project";
import { beforeEach, describe, expect, it } from "vitest";
import {
  emptyProject,
  emptyProjectV2,
  getLegacyObjects,
  validateProject,
  parseProject,
  serializeProject,
  occurrenceMatrix,
  geometryContext,
} from "@forma/document";
import { useEditor } from "@forma/editor";
import { parseOBJ, parseSTL } from "@forma/file-io";
import { primitivePolygons } from "../packages/editor/src/polygon-import";
import {
  geometryFromPolygons,
  id,
  classifyBody,
  prepareSketch,
  validatePrepared,
  transformAffine,
  tessellateFace,
} from "@forma/geometry";
const tetra = `v 0 0 0\nv 10 0 0\nv 0 10 0\nv 0 0 10\nf 1 3 2\nf 1 2 4\nf 2 3 4\nf -2 -4 -1\n`;
const build = (kind: "cube" | "sphere" | "cylinder" | "plane" = "cube") =>
  geometryFromPolygons(
    primitivePolygons(kind, 2),
    "fixture",
    id("definition/fixture"),
    id("material/fixture"),
  );
beforeEach(() => useEditor.getState().replace(emptyProjectV2()));
describe("editable import and primitive conversion", () => {
  it.each(["cube", "plane", "cylinder", "sphere"] as const)(
    "builds canonical %s with valid incidences",
    (kind) => {
      const m = build(kind);
      expect(Object.keys(m.faces).length).toBeGreaterThan(0);
      if (kind !== "plane")
        expect(classifyBody(m, Object.keys(m.bodies)[0])).toBe("closed-shell");
      for (const f of Object.values(m.faces))
        expect(tessellateFace(m, f).area).toBeGreaterThan(0);
    },
  );
  it("parses negative OBJ indices and uses explicit physical units", () => {
    const data = parseOBJ(tetra, 0.001);
    expect(data.positions[1]).toEqual([0.01, 0, 0]);
    expect(data.polygons[3]).toEqual([2, 0, 3]);
  });
  it("reads OBJ wires independently of faces", () => {
    const d = parseOBJ("v 0 0 0\nv 2 0 0\nl 1 2", 1);
    const m = geometryFromPolygons(d, "wire", id("owner"), id("material"));
    expect(Object.keys(m.edges)).toHaveLength(1);
    expect(Object.keys(m.faces)).toHaveLength(0);
  });
  it.each([
    "v 0 0 0\nf 1 2 3",
    "v NaN 0 0",
    "v 0 0 0\nl 0 1",
    "surf 0 1 0 1 1 2 3",
  ])("rejects malformed OBJ: %s", (text) =>
    expect(() => parseOBJ(text, 1)).toThrow(),
  );
  it("reads binary STL, welds shared vertices, rejects truncation", () => {
    const b = new ArrayBuffer(134),
      v = new DataView(b);
    v.setUint32(80, 1, true);
    [
      [0, 0, 0],
      [1000, 0, 0],
      [0, 1000, 0],
    ].forEach((p, i) =>
      p.forEach((n, j) => v.setFloat32(96 + i * 12 + j * 4, n, true)),
    );
    const data = parseSTL(b, 0.001);
    expect(data.positions[1]).toEqual([1, 0, 0]);
    expect(() => parseSTL(b.slice(0, 133), 0.001)).toThrow();
  });
  it("reads strict ASCII STL and rejects trailing corruption", () => {
    const text =
      "solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t";
    expect(
      parseSTL(new TextEncoder().encode(text).buffer, 1).polygons,
    ).toHaveLength(1);
    expect(() =>
      parseSTL(new TextEncoder().encode(text + "\nmalformed").buffer, 1),
    ).toThrow();
  });
  it("rejects nonplanar, degenerate and duplicate polygons", () => {
    const d = primitivePolygons("cube", 2);
    d.positions[0][2] += 0.2;
    expect(() =>
      geometryFromPolygons(d, "bad", id("owner"), id("material")),
    ).toThrow();
    const a = primitivePolygons("plane", 2);
    a.polygons.push([...a.polygons[0]]);
    expect(() =>
      geometryFromPolygons(a, "bad", id("owner"), id("material")),
    ).toThrow();
  });
  it("imports atomically into v1, supports roundtrip, Undo and Redo with identical IDs", () => {
    const old = emptyProject("Legacy");
    useEditor.getState().replace(old);
    expect(
      useEditor
        .getState()
        .importPolygons([{ ...parseOBJ(tetra, 0.001), name: "tetra" }]).status,
    ).toBe("applied");
    const after = useEditor.getState().project;
    validateProject(after);
    expect(parseProject(serializeProject(after))).toEqual(after);
    useEditor.getState().undo();
    expect(useEditor.getState().project).toEqual(old);
    useEditor.getState().redo();
    expect(useEditor.getState().project).toEqual(after);
  });
  it("keeps document identity, dirty signature and both history directions after rejected import", () => {
    useEditor.getState().add("cube");
    useEditor.getState().undo();
    const before = useEditor.getState();
    expect(
      useEditor.getState().importPolygons([
        {
          positions: [
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
          ],
          polygons: [[0, 1, 2]],
          name: "bad",
        },
      ]).status,
    ).toBe("rejected");
    const after = useEditor.getState();
    expect(after.project).toBe(before.project);
    expect(after.savedSignature).toBe(before.savedSignature);
    expect(after.canUndo).toBe(before.canUndo);
    expect(after.canRedo).toBe(before.canRedo);
  });
  it("converts transformed cube without changing material, node ID or physical placement", () => {
    useEditor.getState().add("cube");
    const key = useEditor.getState().selected!;
    useEditor.getState().patch(key, {
      transform: {
        position: [4, 5, 6],
        rotation: [0, 90, 0],
        scale: [2, 3, 4],
      },
    });
    const before = useEditor.getState().project,
      object = getLegacyObjects(before)[0];
    expect(useEditor.getState().convertPrimitive().status).toBe("applied");
    const p = useEditor.getState().project;
    if (p.schemaVersion !== 2) throw Error();
    const node = p.nodes[key];
    if (node.kind === "legacy-primitive") throw Error();
    const m = p.geometries[p.definitions[node.definitionId].geometryId!];
    expect(Object.keys(m.vertices)).toHaveLength(8);
    expect(Object.keys(m.edges)).toHaveLength(12);
    expect(Object.keys(m.faces)).toHaveLength(6);
    expect(node.name).toBe(object.name);
    const world = transformAffine(
      Object.values(m.vertices)[0].position,
      occurrenceMatrix(p, [key]),
    );
    [0, 2, 8].forEach((n, i) => expect(world[i]).toBeCloseTo(n));
    expect(p.materials[Object.values(m.faces)[0].frontMaterialId].color).toBe(
      object.material.color,
    );
    useEditor.getState().undo();
    expect(useEditor.getState().project).toEqual(before);
    useEditor.getState().redo();
    expect(useEditor.getState().project).toEqual(p);
  });
  it("refuses conversion of a locked primitive without history mutation", () => {
    useEditor.getState().add("cube");
    useEditor.getState().setLocked(useEditor.getState().selected!, true);
    const p = useEditor.getState().project;
    expect(useEditor.getState().convertPrimitive().status).toBe("rejected");
    expect(useEditor.getState().project).toBe(p);
  });
});
describe("topological Delete", () => {
  const context = {
    ownerDefinitionId: "definition/fixture",
    materialIds: new Set(["material/fixture"]),
  };
  it.each(["vertex", "edge", "face"] as const)(
    "deletes a real %s and restores exact topology with its inverse",
    (kind) => {
      const before = build(),
        table =
          kind === "vertex"
            ? before.vertices
            : kind === "edge"
              ? before.edges
              : before.faces,
        key = Object.keys(table)[0];
      const change = prepareSketch(
        before,
        { kind: "delete-entities", entityIds: [key] },
        context,
        id("operation/delete"),
      );
      const after = validatePrepared(
        before,
        change,
        context,
        id("operation/delete"),
      );
      expect(Object.keys(after.faces).length).toBeLessThan(6);
      const reverse = {
        ...change,
        forward: change.inverse,
        inverse: change.forward,
        lineage: [],
      };
      expect(
        validatePrepared(after, reverse, context, id("operation/delete")),
      ).toEqual(before);
    },
  );
  it("rejects unknown deletion IDs without mutating the source", () => {
    const m = build(),
      before = structuredClone(m);
    expect(() =>
      prepareSketch(
        m,
        { kind: "delete-entities", entityIds: ["missing"] },
        context,
        id("operation/bad"),
      ),
    ).toThrow();
    expect(m).toEqual(before);
  });
  it("editor deletion uses shared history and preserves neighbouring geometry", async () => {
    useEditor.getState().importPolygons([
      { ...primitivePolygons("cube", 2), name: "cube" },
      { ...primitivePolygons("plane", 2), name: "plane" },
    ]);
    const p = useEditor.getState().project;
    if (p.schemaVersion !== 2) throw Error();
    const m = Object.values(p.geometries).find(
      (g) => Object.keys(g.faces).length === 6,
    )!;
    const node = Object.values(p.nodes).find(
      (n) =>
        n.kind !== "legacy-primitive" && n.definitionId === m.ownerDefinitionId,
    )!;
    const vertex = Object.keys(m.vertices)[0],
      ref = {
        definitionId: m.ownerDefinitionId,
        geometryId: m.id,
        kind: "vertex" as const,
        entityId: vertex,
        occurrencePath: [node.id],
      };
    const result = await useEditor
      .getState()
      .editGeometry(ref, { kind: "delete-entities", entityIds: [vertex] });
    expect(result.status).toBe("applied");
    validateProject(useEditor.getState().project);
    useEditor.getState().undo();
    expect(useEditor.getState().project).toEqual(p);
    expect(geometryContext(p, m.id)).toBeDefined();
  });
  it("does not silently delete geometry in neighbouring shared component instances", async () => {
    const p = componentProject();
    useEditor.getState().replace(p);
    const n = p.nodes["instance/two"];
    if (n.kind === "legacy-primitive") throw Error();
    const d = p.definitions[n.definitionId],
      g = p.geometries[d.geometryId!],
      ref = {
        definitionId: d.id,
        geometryId: g.id,
        kind: "face" as const,
        entityId: Object.keys(g.faces)[0],
        occurrencePath: [n.id],
      };
    useEditor.getState().selectEntity(ref);
    const before = useEditor.getState();
    const result = await useEditor.getState().deleteSelection();
    expect(result.status).toBe("rejected");
    expect(useEditor.getState().project).toBe(before.project);
    expect(useEditor.getState().canUndo).toBe(false);
  });
});
