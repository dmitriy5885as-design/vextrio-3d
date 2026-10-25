import { readFileSync } from "node:fs";
import { beforeEach, expect, it } from "vitest";
import {
  parseProject,
  serializeProject,
  migrateProject,
  emptyProject,
  getLegacyObjects,
  emptyProjectV2,
  validateProject,
  type ProjectV2,
} from "@forma/document";
import { tessellateFace, canonical, id } from "@forma/geometry";
import { useEditor, isDirty } from "@forma/editor";
import { TopologyBridge } from "../packages/viewport/src/TopologyBridge";
import {
  componentProject,
  firstRef,
  topologyProject,
} from "./fixtures/v2-project";
beforeEach(() => useEditor.getState().replace(emptyProject()));
it.each(["hole", "components"])(
  "roundtrips the published %s v2 fixture",
  (name) => {
    const text = readFileSync(`tests/fixtures/v2/${name}.v3d`, "utf8");
    const p = parseProject(text);
    expect(p.schemaVersion).toBe(2);
    expect(parseProject(serializeProject(p))).toEqual(p);
    expect(p).toEqual(
      JSON.parse(
        serializeProject(
          name === "hole" ? topologyProject() : componentProject(),
        ),
      ),
    );
  },
);
it("rejects corrupt reserved legacy extension data", () => {
  const p = topologyProject();
  p.extensions.legacyFields = "invalid";
  expect(() => validateProject(p)).toThrow(/данные/);
});
it.each(["m", "cm", "mm"])(
  "deterministically migrates golden v1 %s without moving legacy children or changing user data",
  (unit) => {
    const p = parseProject(
        readFileSync(`tests/fixtures/v1/${unit}.v3d`, "utf8"),
      ),
      before = structuredClone(p),
      a = migrateProject(p),
      b = migrateProject(p);
    expect(a).toEqual(b);
    expect(getLegacyObjects(a)).toEqual(getLegacyObjects(p));
    expect(p).toEqual(before);
    expect(parseProject(serializeProject(a))).toEqual(a);
  },
);
it("preserves non-ASCII legacy IDs, metadata and nested unknown material/transform fields", () => {
  const p = JSON.parse(readFileSync("tests/fixtures/v1/m.v3d", "utf8"));
  p.objects[0].id = "объект / основание";
  p.objects[1].parentId = p.objects[0].id;
  p.objects[0].material.id = "user material id";
  p.objects[0].transform.vendor = { x: 42 };
  p.custom = { items: [1, 2] };
  const v = migrateProject(p);
  expect(getLegacyObjects(v)).toEqual(p.objects);
  expect(v.extensions.legacyFields).toMatchObject({ custom: p.custom });
});
it("opens and roundtrips a real S3 topology with a hole", () => {
  const p = topologyProject();
  validateProject(p);
  expect(canonical(parseProject(serializeProject(p)))).toBe(canonical(p));
  const g = Object.values(p.geometries)[0],
    dto = tessellateFace(g, Object.values(g.faces)[0]);
  expect(dto.area).toBe(11);
  expect(dto.indices.length / 3).toBe(8);
});
it("validates groups/components and their shared native geometry, never copies their entities", () => {
  const p = componentProject();
  validateProject(p);
  expect(canonical(parseProject(serializeProject(p)))).toBe(canonical(p));
  const bridge = new TopologyBridge(p, 1);
  expect(
    bridge.pickables.filter((o) => o.userData.entityRef?.kind === "face"),
  ).toHaveLength(4);
  expect(Object.keys(p.geometries)).toHaveLength(1);
  bridge.dispose();
});
it.each([
  "dangling",
  "ownership",
  "cycle",
  "material",
  "duplicate",
  "format",
] as const)("rejects broken v2 %s before replacing the editor", (kind) => {
  const p = topologyProject(),
    g = Object.values(p.geometries)[0];
  if (kind === "dangling") Object.values(g.edges)[0].end = "missing" as never;
  if (kind === "ownership") g.ownerDefinitionId = "missing" as never;
  if (kind === "cycle")
    p.definitions[p.rootDefinitionId].childNodeIds.push("missing" as never);
  if (kind === "material") delete p.materials["native/material"];
  if (kind === "duplicate") {
    const v = Object.values(g.vertices)[0];
    p.references[v.id] = { id: v.id, target: firstRef(p) };
  }
  if (kind === "format") Object.assign(p, { format: "vextrio" });
  const state = useEditor.getState(),
    before = structuredClone(state.project),
    revision = state.revision;
  expect(() => parseProject(JSON.stringify(p))).toThrow();
  expect(state.replace(p).status).toBe("rejected");
  expect(useEditor.getState().project).toEqual(before);
  expect(useEditor.getState().revision).toBe(revision);
});
it("mixes topology changes and primitive commands in one undo/redo stack", async () => {
  const p = topologyProject();
  useEditor.getState().replace(p);
  const initial = structuredClone(useEditor.getState().project),
    ref = firstRef(p);
  expect(
    (
      await useEditor.getState().editGeometry(ref, {
        kind: "delete-entities",
        entityIds: [ref.entityId],
      })
    ).status,
  ).toBe("applied");
  const deleted = structuredClone(useEditor.getState().project);
  useEditor.getState().add("cube");
  expect(getLegacyObjects(useEditor.getState().project)).toHaveLength(1);
  useEditor.getState().undo();
  expect(useEditor.getState().project).toEqual(deleted);
  useEditor.getState().undo();
  expect(useEditor.getState().project).toEqual(initial);
  useEditor.getState().redo();
  expect(useEditor.getState().project).toEqual(deleted);
  useEditor.getState().redo();
  expect(getLegacyObjects(useEditor.getState().project)).toHaveLength(1);
  expect(isDirty()).toBe(true);
});
it("keeps dirty, selection and redo intact after rejected geometry and stale work", async () => {
  const p = topologyProject(),
    ref = firstRef(p);
  useEditor.getState().replace(p);
  useEditor.getState().selectEntity(ref);
  const before = structuredClone(useEditor.getState().project),
    revision = useEditor.getState().revision;
  expect(
    (
      await useEditor.getState().editGeometry(ref, {
        kind: "insert-segments",
        segments: [
          [
            [0, 0, 0],
            [0, 0, 0],
          ],
        ],
        plane: null,
      })
    ).status,
  ).toBe("rejected");
  expect(useEditor.getState().topologySelection).toEqual(ref);
  expect(useEditor.getState().project).toEqual(before);
  expect(useEditor.getState().revision).toBe(revision);
  expect(isDirty()).toBe(false);
  const pending = useEditor
    .getState()
    .editGeometry(ref, { kind: "delete-entities", entityIds: [ref.entityId] });
  useEditor.getState().replace(emptyProjectV2("new"));
  expect((await pending).status).toBe("rejected");
  expect(useEditor.getState().project.name).toBe("new");
});
it("respects locks on every occurrence of a shared component definition", async () => {
  const p = componentProject();
  p.nodes["instance/two"].locked = true;
  useEditor.getState().replace(p);
  const g = Object.values(p.geometries)[0],
    ref = {
      ...firstRef(p),
      definitionId: g.ownerDefinitionId,
      occurrencePath: ["instance/group", "instance/one"],
    };
  expect(
    (
      await useEditor.getState().editGeometry(ref, {
        kind: "delete-entities",
        entityIds: [ref.entityId],
      })
    ).status,
  ).toBe("rejected");
  expect(useEditor.getState().project).toEqual(p);
});
it("keeps v2 legacy tools editable while guarding locked ancestors and mixed patches", () => {
  const p = migrateProject(
    parseProject(readFileSync("tests/fixtures/v1/m.v3d", "utf8")),
  );
  useEditor.getState().replace(p);
  const s = useEditor.getState();
  expect(s.patch("legacy-sphere", { name: "new" }).status).toBe("applied");
  s.undo();
  expect(s.project).toEqual(p);
  expect(s.patch("legacy-cylinder", { name: "locked" }).status).toBe(
    "rejected",
  );
  expect(
    s.patch("legacy-cylinder", { locked: false, name: "bypass" } as never)
      .status,
  ).toBe("rejected");
});
it("performs migration as a single reversible editor command and persists the schema", () => {
  const p = emptyProject("v1");
  useEditor.getState().replace(p);
  expect(useEditor.getState().upgradeProject().status).toBe("applied");
  expect(useEditor.getState().project.schemaVersion).toBe(2);
  useEditor.getState().undo();
  expect(useEditor.getState().project).toEqual(p);
  useEditor.getState().redo();
  expect(useEditor.getState().project.schemaVersion).toBe(2);
});
it("renders derived buffers without mutating canonical topology and releases them", () => {
  const p = topologyProject(),
    before = canonical(p),
    bridge = new TopologyBridge(p, 7);
  expect(bridge.pickables.some((o) => o.type === "LineSegments")).toBe(true);
  expect(bridge.pickables.some((o) => o.type === "Points")).toBe(true);
  expect(canonical(p)).toBe(before);
  let disposed = 0;
  for (const o of bridge.pickables)
    if ("geometry" in o)
      (o.geometry as import("three").BufferGeometry).addEventListener(
        "dispose",
        () => disposed++,
      );
  bridge.dispose();
  expect(disposed).toBeGreaterThan(0);
  expect(bridge.pickables).toHaveLength(0);
});
it("preserves references to unchanged entities through save/open", () => {
  const p: ProjectV2 = topologyProject(),
    ref = firstRef(p, "edge");
  p.references["reference/edge"] = { id: "reference/edge", target: ref };
  expect(canonical(parseProject(serializeProject(p)))).toBe(canonical(p));
});
it("v2 no-op keeps the redo branch, node ordering and optional extensions unchanged", () => {
  const p = migrateProject(
    parseProject(readFileSync("tests/fixtures/v1/m.v3d", "utf8")),
  );
  delete p.extensions.legacyFields;
  useEditor.getState().replace(p);
  useEditor.getState().patch("legacy-sphere", { name: "temporary" });
  useEditor.getState().undo();
  const before = JSON.stringify(useEditor.getState().project),
    revision = useEditor.getState().revision;
  expect(useEditor.getState().mutate("noop", () => {}).status).toBe("noop");
  expect(JSON.stringify(useEditor.getState().project)).toBe(before);
  expect(useEditor.getState().revision).toBe(revision);
  expect(useEditor.getState().canRedo).toBe(true);
});
it("v2 node transforms, visibility and locks use the same atomic history", () => {
  const p = componentProject();
  useEditor.getState().replace(p);
  const s = useEditor.getState();
  expect(s.patchNode("instance/two", { visible: false }).status).toBe(
    "applied",
  );
  expect(
    (useEditor.getState().project as ProjectV2).nodes["instance/two"].visible,
  ).toBe(false);
  s.undo();
  expect(useEditor.getState().project).toEqual(p);
  expect(s.setNodeLocked("instance/group", true).status).toBe("applied");
  const before = structuredClone(useEditor.getState().project);
  expect(s.patchNode("instance/one", { name: "bypass" }).status).toBe(
    "rejected",
  );
  expect(s.setNodeLocked("instance/one", false).status).toBe("rejected");
  expect(
    s.patchNode("instance/group", { locked: false, visible: false } as never)
      .status,
  ).toBe("rejected");
  expect(useEditor.getState().project).toEqual(before);
  expect(s.setNodeLocked("instance/group", false).status).toBe("applied");
  expect(s.patchNode("instance/one", { name: "editable" }).status).toBe(
    "applied",
  );
});
it("rejects invalid node transforms without changing dirty or revision", () => {
  const p = componentProject();
  useEditor.getState().replace(p);
  const before = structuredClone(useEditor.getState().project),
    revision = useEditor.getState().revision;
  const t = structuredClone(p.nodes["instance/two"].transform);
  t.scale[0] = 0;
  expect(
    useEditor.getState().patchNode("instance/two", {
      transform: t as import("@forma/geometry").PlacementTransform,
    }).status,
  ).toBe("rejected");
  expect(useEditor.getState().project).toEqual(before);
  expect(useEditor.getState().revision).toBe(revision);
  expect(isDirty()).toBe(false);
});
it("does not apply native work after Undo or another document command", async () => {
  const p = topologyProject(),
    ref = firstRef(p);
  useEditor.getState().replace(p);
  const pending = useEditor
    .getState()
    .editGeometry(ref, { kind: "delete-entities", entityIds: [ref.entityId] });
  useEditor.getState().add("cube");
  expect((await pending).status).toBe("rejected");
  expect(
    Object.keys(
      (useEditor.getState().project as ProjectV2).geometries[ref.geometryId]
        .faces,
    ),
  ).toHaveLength(1);
  expect(getLegacyObjects(useEditor.getState().project)).toHaveLength(1);
});
it("camera navigation does not invalidate or get overwritten by a pending geometry command", async () => {
  const p = topologyProject(),
    ref = firstRef(p);
  useEditor.getState().replace(p);
  const pending = useEditor
    .getState()
    .editGeometry(ref, { kind: "delete-entities", entityIds: [ref.entityId] });
  const camera = { ...p.camera, zoom: 2 };
  useEditor.getState().setCamera(camera);
  expect((await pending).status).toBe("applied");
  expect(useEditor.getState().project.camera.zoom).toBe(2);
  useEditor.getState().undo();
  expect(useEditor.getState().project.camera.zoom).toBe(2);
});
it("persisted references remain valid across retirement, save/open and Undo/Redo", async () => {
  const p = topologyProject(),
    ref = firstRef(p);
  p.references["reference/original-face"] = {
    id: "reference/original-face",
    target: ref,
  };
  useEditor.getState().replace(p);
  expect(
    (
      await useEditor.getState().editGeometry(ref, {
        kind: "delete-entities",
        entityIds: [ref.entityId],
      })
    ).status,
  ).toBe("applied");
  const after = useEditor.getState().project as ProjectV2;
  expect(
    after.provenance.find((l) => l.retiredId === ref.entityId)?.reason,
  ).toBe("delete");
  expect(canonical(parseProject(serializeProject(after)))).toBe(
    canonical(after),
  );
  useEditor.getState().undo();
  expect(useEditor.getState().project).toEqual(p);
  useEditor.getState().redo();
  expect(canonical(useEditor.getState().project)).toBe(canonical(after));
});
it.each(["missing", "cycle", "wrong-kind", "wrong-geometry", "range"] as const)(
  "rejects malformed provenance %s",
  (kind) => {
    const p = topologyProject(),
      g = Object.values(p.geometries)[0],
      edge = Object.keys(g.edges)[0];
    const l: import("@forma/document").DocumentLineage = {
      geometryId: g.id,
      operationId: id("op/history"),
      kind: "edge" as const,
      retiredId: "retired/edge",
      reason: "convert" as const,
      descendants: [{ id: edge, parameterRange: [0, 1] as [number, number] }],
    };
    p.provenance = [l];
    if (kind === "missing") l.descendants[0].id = "missing";
    if (kind === "cycle") {
      l.descendants[0].id = "retired/second";
      p.provenance.push({
        ...l,
        retiredId: "retired/second",
        descendants: [{ id: "retired/edge" }],
      });
    }
    if (kind === "wrong-kind") l.descendants[0].id = Object.keys(g.vertices)[0];
    if (kind === "wrong-geometry") l.geometryId = "missing";
    if (kind === "range") l.descendants[0].parameterRange = [0.8, 0.2];
    expect(() => parseProject(JSON.stringify(p))).toThrow();
  },
);
it.each([
  "material-fields",
  "extensions",
  "unknown-representation",
  "bad-path",
] as const)("rejects malformed canonical v2 %s", (kind) => {
  const p = topologyProject();
  if (kind === "material-fields")
    Object.assign(p.materials["native/material"], { userData: [] });
  if (kind === "extensions") Object.assign(p, { extensions: "string" });
  if (kind === "unknown-representation")
    Object.assign(Object.values(p.geometries)[0], {
      representation: "occt-brep",
    });
  if (kind === "bad-path")
    p.references["reference/test"] = {
      id: "reference/test",
      target: { ...firstRef(p), occurrencePath: ["missing"] },
    };
  expect(() => parseProject(JSON.stringify(p))).toThrow();
});
it("migration chooses collision-free deterministic IDs without changing existing IDs", () => {
  const p = emptyProject(),
    object = {
      id: "v2/root",
      name: "original",
      type: "cube" as const,
      geometry: { kind: "cube" as const, size: 1 },
      transform: {
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
      },
      material: { color: "#123456", roughness: 0.5, metalness: 0 },
      visible: true,
      locked: false,
      parentId: null,
    };
  p.objects = [object, { ...structuredClone(object), id: "v2/material/0" }];
  const a = migrateProject(p),
    b = migrateProject(p);
  expect(a).toEqual(b);
  expect(a.rootDefinitionId).not.toBe("v2/root");
  expect(getLegacyObjects(a)).toEqual(p.objects);
});
it("v2 copy-on-write material edits do not mutate another primitive sharing the same material", () => {
  const p = migrateProject(
      parseProject(readFileSync("tests/fixtures/v1/m.v3d", "utf8")),
    ),
    a = p.nodes["legacy-cube"],
    b = p.nodes["legacy-sphere"];
  if (a.kind !== "legacy-primitive" || b.kind !== "legacy-primitive")
    throw Error("legacy fixture");
  b.materialId = a.materialId;
  useEditor.getState().replace(p);
  const original = getLegacyObjects(p).find(
    (o) => o.id === "legacy-sphere",
  )!.material;
  expect(
    useEditor
      .getState()
      .patch(a.id, { material: { ...original, color: "#ff0000" } }).status,
  ).toBe("applied");
  expect(
    getLegacyObjects(useEditor.getState().project).find((o) => o.id === b.id)!
      .material,
  ).toEqual(original);
});
