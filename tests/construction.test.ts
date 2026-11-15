import { makeUnique, removeInstance } from "../packages/editor/src/structure";
import { SnapEngine, workPlane } from "@forma/snapping";
import { beforeEach, expect, it } from "vitest";
import { useEditor, isDirty } from "@forma/editor";
import {
  constructionData,
  constructionKey,
  emptyProjectV2,
  measurement,
  parseProject,
  serializeProject,
  validateProject,
} from "@forma/document";
import { ConstructionBridge } from "../packages/viewport/src/ConstructionBridge";
import { componentProject } from "./fixtures/v2-project";
beforeEach(() => useEditor.getState().replace(emptyProjectV2()));
it("measures distance and near-parallel angles in metres without mutating points", () => {
  const a: [number, number, number] = [0, 0, 0],
    b: [number, number, number] = [3, 0, 4];
  expect(measurement(a, b).distance).toBe(5);
  expect(measurement(a, [1, 0, 0], [1, 1e-10, 0]).angle).toBeCloseTo(1e-10, 18);
  expect(measurement(a, [1, 0, 0], [-1, 0, 0]).angle).toBe(Math.PI);
  expect(a).toEqual([0, 0, 0]);
  expect(b).toEqual([3, 0, 4]);
  expect(() => measurement(a, a)).toThrow();
});
it("persists guides independently from topology and restores their IDs through undo/redo", () => {
  const editor = useEditor.getState();
  expect(editor.addGuide([], [1, 2, 3], [1, 0, 0]).status).toBe("applied");
  const p = useEditor.getState().project;
  if (p.schemaVersion !== 2) throw Error();
  const guides = constructionData(p).guides;
  expect(Object.keys(guides)).toHaveLength(1);
  expect(p.geometries).toEqual({});
  expect(parseProject(serializeProject(p))).toEqual(p);
  editor.undo();
  expect(
    constructionData(useEditor.getState().project as typeof p).guides,
  ).toEqual({});
  editor.redo();
  expect(
    constructionData(useEditor.getState().project as typeof p).guides,
  ).toEqual(guides);
  editor.removeGuides([], Object.keys(guides));
  expect(
    constructionData(useEditor.getState().project as typeof p).guides,
  ).toEqual({});
  editor.undo();
  expect(
    constructionData(useEditor.getState().project as typeof p).guides,
  ).toEqual(guides);
});
it("rejects invalid commands atomically without changing dirty-state or redo", () => {
  const editor = useEditor.getState();
  editor.addGuide([], [0, 0, 0]);
  editor.undo();
  const before = useEditor.getState(),
    dirty = isDirty();
  expect(editor.addGuide([], [0, 0, 0], [0, 0, 0]).status).toBe("rejected");
  expect(editor.addGuide(["missing"], [0, 0, 0]).status).toBe("rejected");
  expect(editor.removeGuides([], ["unknown"]).status).toBe("rejected");
  const after = useEditor.getState();
  expect(after.project).toBe(before.project);
  expect(after.revision).toBe(before.revision);
  expect(after.canRedo).toBe(true);
  expect(isDirty()).toBe(dirty);
});
it("validates known extension IDs and contexts while preserving vendor data", () => {
  const p = emptyProjectV2();
  p.extensions.vendor = { preserved: true };
  p.extensions[constructionKey] = {
    version: 1,
    guides: {
      [p.rootDefinitionId]: {
        id: p.rootDefinitionId,
        definitionId: p.rootDefinitionId,
        kind: "point",
        origin: [0, 0, 0],
      },
    },
  };
  expect(() => validateProject(p)).toThrow(/ID/);
  p.extensions[constructionKey] = { version: 2, guides: {} };
  expect(() => validateProject(p)).toThrow(/направляющие/);
  delete p.extensions[constructionKey];
  expect(parseProject(serializeProject(p))).toEqual(p);
});
it("refuses shared definitions and locked contexts", () => {
  const p = componentProject();
  useEditor.getState().replace(p);
  const group = Object.values(p.nodes).find(
    (n) => n.kind !== "legacy-primitive",
  )!;
  expect(useEditor.getState().addGuide([group.id], [0, 0, 0]).status).toBe(
    "applied",
  );
  const shared = Object.values(p.definitions).find((d) => d.geometryId)!;
  const sharedPath = Object.values(p.nodes).filter(
    (n) => n.kind !== "legacy-primitive" && n.definitionId === shared.id,
  );
  // The nested and direct occurrences share the same definition.
  expect(sharedPath.length).toBeGreaterThan(0);
  const direct = sharedPath.find(
    (n) => n.parentDefinitionId === p.rootDefinitionId,
  )!;
  expect(useEditor.getState().addGuide([direct.id], [0, 0, 0]).status).toBe(
    "rejected",
  );
  const locked = structuredClone(p);
  locked.nodes[group.id].locked = true;
  useEditor.getState().replace(locked);
  expect(useEditor.getState().addGuide([group.id], [0, 0, 0]).status).toBe(
    "rejected",
  );
});
it("renders guides without mesh topology and cleans up stale geometry", () => {
  useEditor.getState().addGuide([], [0, 0, 0], [1, 0, 0]);
  const bridge = new ConstructionBridge();
  bridge.update(useEditor.getState().project);
  expect(bridge.root.children).toHaveLength(1);
  expect(bridge.root.children[0].type).toBe("Line");
  useEditor.getState().undo();
  bridge.update(useEditor.getState().project);
  expect(bridge.root.children).toHaveLength(0);
  bridge.dispose();
});

it("snaps to an infinite guide beyond its display segment without exposing a fake entity ref", () => {
  useEditor.getState().addGuide([], [0, 0, 0], [1, 0, 0]);
  const p = useEditor.getState().project;
  if (p.schemaVersion !== 2) throw Error();
  const engine = new SnapEngine(p);
  const q = {
    cursor: [2001, 0] as [number, number],
    project: (p: [number, number, number]) => ({
      x: p[0],
      y: p[1],
      depth: 10,
      visible: true,
      w: 1,
    }),
    ray: {
      origin: [2001, 0, 10] as [number, number, number],
      direction: [0, 0, -1] as [number, number, number],
    },
    plane: workPlane("XY"),
    anchor: [0, 0, 0] as [number, number, number],
    axes: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ] as [number, number, number][],
    gridStep: 0,
    enabled: true,
    kinds: ["guide"] as const,
  };
  const result = engine.query(q).candidate;
  expect(result?.kind).toBe("guide");
  expect(result?.point).toEqual([2001, 0, 0]);
  expect(result?.ref).toBeUndefined();
  expect(engine.query({ ...q, enabled: false }).candidate).toBeNull();
});

it("copies guide identities for a unique component and removes orphan guides with its last instance", () => {
  const p = componentProject();
  const definition = Object.values(p.definitions).find((d) => d.geometryId)!;
  const node = Object.values(p.nodes).find(
    (n) =>
      n.kind !== "legacy-primitive" &&
      n.definitionId === definition.id &&
      n.parentDefinitionId === p.rootDefinitionId,
  )!;
  p.extensions[constructionKey] = {
    version: 1,
    guides: {
      "guide/original": {
        id: "guide/original",
        definitionId: definition.id,
        kind: "point",
        origin: [1, 2, 3],
      },
    },
  };
  const did = makeUnique(p, node.id);
  const copied = Object.values(constructionData(p).guides).find(
    (g) => g.definitionId === did,
  )!;
  expect(copied.id).not.toBe("guide/original");
  expect(copied.origin).toEqual([1, 2, 3]);
  validateProject(p);
  removeInstance(p, node.id);
  validateProject(p);
  expect(constructionData(p).guides[copied.id]).toBeUndefined();
  expect(constructionData(p).guides["guide/original"]).toBeDefined();
});

it("places a guide in a rotated nonuniform group and respects hidden, locked and editing contexts", () => {
  const p = componentProject(),
    group = p.nodes["instance/group"];
  if (group.kind === "legacy-primitive") throw Error();
  group.transform.scale = [2, 3, 4];
  group.transform.rotation = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
  useEditor.getState().replace(p);
  expect(useEditor.getState().addGuide([group.id], [1, 2, 3]).status).toBe(
    "applied",
  );
  const saved = structuredClone(useEditor.getState().project) as typeof p;
  const bridge = new ConstructionBridge();
  bridge.update(saved);
  const point = bridge.root.children[0] as import("three").Points;
  const position = point.geometry.getAttribute("position");
  expect(position.getX(0)).toBeCloseTo(-11, 6);
  expect(position.getY(0)).toBeCloseTo(2, 6);
  expect(position.getZ(0)).toBeCloseTo(12, 6);
  const q = {
    cursor: [-11, 2] as [number, number],
    project: (p: [number, number, number]) => ({
      x: p[0],
      y: p[1],
      depth: 10,
      visible: true,
      w: 1,
    }),
    ray: {
      origin: [-11, 2, 22] as [number, number, number],
      direction: [0, 0, -1] as [number, number, number],
    },
    plane: workPlane("XY"),
    anchor: [0, 0, 0] as [number, number, number],
    axes: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ] as [number, number, number][],
    gridStep: 0,
    enabled: true,
    kinds: ["guide"] as const,
    contextOnly: true,
    contextPath: [group.id],
  };
  expect(new SnapEngine(saved).query(q).candidate?.kind).toBe("guide");
  expect(
    new SnapEngine(saved).query({ ...q, contextPath: [] }).candidate,
  ).toBeNull();
  saved.nodes[group.id].locked = true;
  expect(new SnapEngine(saved).query(q).candidate).toBeNull();
  expect(
    new SnapEngine(saved).query({ ...q, includeLocked: true }).candidate?.kind,
  ).toBe("guide");
  saved.nodes[group.id].visible = false;
  expect(
    new SnapEngine(saved).query({ ...q, includeLocked: true }).candidate,
  ).toBeNull();
  bridge.update(saved); // Same-reference changes are not part of the immutable editor contract.
  bridge.update(structuredClone(saved));
  expect(bridge.root.children).toHaveLength(0);
  bridge.dispose();
});
