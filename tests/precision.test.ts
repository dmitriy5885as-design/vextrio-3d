import { expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { createPrecisionExamples } from "./fixtures/precision-examples";
import {
  parseDimension,
  resolvePrecision,
  workPlane,
  formatDimension,
  SnapEngine,
  rayOnPlane,
  type SnapQuery,
} from "@forma/snapping";
import {
  identityMatrix,
  transformAffine,
  id,
  emptyGeometry,
  canonical,
  type Vec3,
} from "@forma/geometry";
import {
  occurrenceMatrix,
  validateProject,
  serializeProject,
  parseProject,
  type ProjectV2,
} from "@forma/document";
import { usePrecision, useEditor, localPrecisionPoint } from "@forma/editor";
import { topologyProject, componentProject } from "./fixtures/v2-project";
import { precisionProject } from "./fixtures/precision-project";
it("refuses a near-parallel construction ray whose target exceeds the coordinate domain", () => {
  expect(rayOnPlane([0, 0, 100], [1, 0, -1e-11], workPlane("XY"))).toBeNull();
});
it("rejects a pending precise edit after the interaction context changes without touching history", async () => {
  const p = precisionProject(),
    g = Object.values(p.geometries)[0],
    v = Object.values(g.vertices)[0];
  useEditor.getState().replace(p);
  let active = true;
  const pending = useEditor.getState().editGeometry(
    {
      definitionId: p.rootDefinitionId,
      geometryId: g.id,
      entityId: v.id,
      kind: "vertex",
      occurrencePath: [],
    },
    {
      kind: "move-vertices",
      positions: [{ vertexId: v.id, position: [-1, 0, 0] }],
    },
    () => active,
  );
  active = false;
  expect((await pending).status).toBe("rejected");
  expect(useEditor.getState().project).toEqual(p);
  expect(useEditor.getState().canUndo).toBe(false);
});
beforeEach(() => {
  usePrecision.getState().configure({
    enabled: false,
    path: [],
    system: "world",
    planeName: "XY",
    axis: null,
    gridStep: 0.25,
    contextOnly: false,
  });
  usePrecision.getState().setAnchor([0, 0, 0]);
});
it.each([
  ["2,5 м", "mm", 2.5],
  ["250 cm", "m", 2.5],
  ["2500мм", "cm", 2.5],
  [".25m", "mm", 0.25],
  ["1e-3 m", "m", 0.001],
  ["1,25", "cm", 0.0125],
] as const)("parses %s in %s without changing physical units", (s, u, n) =>
  expect(parseDimension(s, u)).toBe(n),
);
it.each([
  "",
  "1,2,3",
  "1.2.3",
  "NaN",
  "Infinity",
  "1e309",
  "1e-999",
  "-2 m",
  "0",
  "1 km",
  "1;2",
  "1e10 m",
])("rejects malformed/unsupported size %s", (s) =>
  expect(() => parseDimension(s, "m")).toThrow(),
);
const base = () => ({
  text: "1",
  mode: "coordinates" as const,
  unit: "m" as const,
  anchor: [1, 2, 3] as Vec3,
  direction: [1, 0, 0] as Vec3,
  matrix: identityMatrix(),
  plane: workPlane("XY"),
  system: "world" as const,
  relative: false,
});
it("accepts signed decimal-comma XYZ and explicit absolute/relative syntax", () => {
  expect(
    resolvePrecision({ ...base(), text: "-1,5 м; 20 cm; 0" }).point,
  ).toEqual([-1.5, 0.2, 0]);
  expect(resolvePrecision({ ...base(), text: "@-1; 2; 3" }).point).toEqual([
    0, 4, 6,
  ]);
  expect(
    resolvePrecision({ ...base(), text: "=1;2;3", relative: true }).point,
  ).toEqual([1, 2, 3]);
});
it("does not round an exact length to the grid, and preserves physical length on a scaled local axis", () => {
  const matrix = identityMatrix();
  matrix[0] = 3;
  const result = resolvePrecision({
    ...base(),
    matrix,
    system: "local",
    mode: "length",
    text: "1234,567 mm",
    axis: "X",
  });
  expect(result.point).toEqual([2.234567, 2, 3]);
});
it("rejects missing direction and conflicting numeric constraints", () => {
  expect(() =>
    resolvePrecision({ ...base(), mode: "length", direction: [0, 0, 0] }),
  ).toThrow(/направление/);
  expect(() =>
    resolvePrecision({ ...base(), text: "1;3;3", axis: "X" }),
  ).toThrow(/противоречат/);
  expect(() => resolvePrecision({ ...base(), text: "1,2,3" })).toThrow(
    /запятой/,
  );
});
it("previews a physical 4 by 3 metre rectangle on an affine-derived orthonormal working plane", () => {
  const matrix = [2, 1, 0, 0, 1, 3, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1];
  const plane = workPlane("XY", matrix),
    r = resolvePrecision({
      ...base(),
      plane,
      matrix,
      mode: "rectangle",
      text: "400 см; 3000 мм",
    });
  expect(r.rectangle?.width).toBe(4);
  expect(r.rectangle?.height).toBe(3);
  expect(
    Math.hypot(
      ...r.rectangle!.corners[1].map((v, i) => v - r.rectangle!.corners[0][i]),
    ),
  ).toBeCloseTo(4, 12);
  expect(() =>
    resolvePrecision({ ...base(), mode: "rectangle", text: "1;-2" }),
  ).toThrow();
});
it("keeps typed rectangle dimensions in the cursor quadrant", () => {
  for (const x of [-1, 1])
    for (const y of [-1, 1]) {
      const result = resolvePrecision({
        ...base(),
        plane: workPlane("XY"),
        direction: [x, y, 0],
        mode: "rectangle",
        text: "4000mm;3000mm",
      });
      const corners = result.rectangle!.corners;
      expect(corners[2].map((v, i) => v - corners[0][i])).toEqual([
        4 * x,
        3 * y,
        0,
      ]);
    }
});
it("uses the full nested sheared occurrence matrix for local input and inverse editing", () => {
  const p = componentProject(),
    a = p.nodes["instance/group"],
    b = p.nodes["instance/one"];
  a.transform.scale = [2, 1, 1];
  if (a.kind === "legacy-primitive" || b.kind === "legacy-primitive")
    throw Error("fixture");
  b.transform.rotation = [0, 0, Math.sin(0.3), Math.cos(0.3)];
  const path = [a.id, b.id],
    matrix = occurrenceMatrix(p, path);
  const result = resolvePrecision({
    ...base(),
    system: "local",
    matrix,
    text: "1,5;2;0",
  });
  expect(result.point).toEqual(transformAffine([1.5, 2, 0], matrix));
  localPrecisionPoint(p, path, result.point).forEach((n, i) =>
    expect(n).toBeCloseTo([1.5, 2, 0][i], 12),
  );
});
function query(point: Vec3, scale = 100): SnapQuery {
  return {
    cursor: [100 + point[0] * scale, 400 - point[1] * scale],
    project: (p) => ({
      x: 100 + p[0] * scale,
      y: 400 - p[1] * scale,
      depth: 10 - p[2],
      visible: p[2] < 10,
      w: 1,
    }),
    ray: { origin: [point[0], point[1], 10], direction: [0, 0, -1] },
    plane: workPlane("XY"),
    anchor: [-10, -13, 0],
    axes: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    gridStep: 0,
    enabled: true,
  };
}
it("finds endpoint, midpoint and arbitrary on-edge points", () => {
  const e = new SnapEngine(precisionProject());
  expect(e.query(query([0, 0, 0])).candidate?.kind).toBe("endpoint");
  e.reset();
  expect(e.query(query([2, 0, 0])).candidate?.kind).toBe("midpoint");
  e.reset();
  const r = e.query(query([1.23, 0.02, 0]));
  expect(r.candidate?.kind).toBe("edge");
  expect(r.candidate?.point).toEqual([1.23, 0, 0]);
});
it("finds isolated vertices and X junction intersections with canonical references", () => {
  const p = precisionProject([
      [
        [-1, 0, 0],
        [1, 0, 0],
      ],
      [
        [0, -1, 0],
        [0, 1, 0],
      ],
    ]),
    e = new SnapEngine(p);
  const result = e.query(query([0, 0, 0]));
  expect(result.candidate?.kind).toBe("intersection");
  expect(result.candidate?.ref?.geometryId).toBe("precision/geometry");
  const g = p.geometries["precision/geometry"];
  g.vertices["isolated"] = { id: id("isolated"), position: [5, 5, 0] };
  expect(new SnapEngine(p).query(query([5, 5, 0])).candidate?.kind).toBe(
    "vertex",
  );
});
it("snaps to real face regions but never to a hole", () => {
  const e = new SnapEngine(topologyProject());
  expect(e.query(query([3, 1.5, 0])).candidate?.kind).toBe("face");
  e.reset();
  expect(
    e.query(query([1.5, 1.5, 0])).candidates.some((c) => c.kind === "face"),
  ).toBe(false);
});
it("does not invent intersections of skew segments projected onto the same pixels", () => {
  const p = precisionProject([
    [
      [-1, 0, 0],
      [1, 0, 0],
    ],
    [
      [0, -1, 1],
      [0, 1, 1],
    ],
  ]);
  expect(
    new SnapEngine(p)
      .query(query([0, 0, 0]))
      .candidates.some((c) => c.kind === "intersection"),
  ).toBe(false);
});
it("does not intersect different component occurrences and supports active-context filtering", () => {
  const p = componentProject(),
    node = p.nodes["instance/two"];
  if (node.kind === "legacy-primitive") throw Error("fixture");
  node.transform.translation = [-5, 0, 0];
  const e = new SnapEngine(p),
    q = query([-3, 0, 0]);
  q.contextOnly = true;
  q.contextPath = ["instance/two"];
  const r = e.query(q);
  expect(
    r.candidates
      .filter((c) => c.ref)
      .every(
        (c) => JSON.stringify(c.ref!.occurrencePath) === '["instance/two"]',
      ),
  ).toBe(true);
});
it("respects hidden parents and excludes locked occurrences unless requested", () => {
  const p = componentProject();
  p.nodes["instance/group"].visible = false;
  p.nodes["instance/two"].locked = true;
  const e = new SnapEngine(p);
  expect(
    e.query(query([-5, 0, 0])).candidates.filter((c) => c.ref),
  ).toHaveLength(0);
  expect(
    e.query(query([5, 0, 0])).candidates.filter((c) => c.ref),
  ).toHaveLength(0);
  expect(
    e
      .query({ ...query([5, 0, 0]), includeLocked: true })
      .candidates.some((c) => c.ref),
  ).toBe(true);
});
it.each([10, 100, 1000])(
  "uses pixel capture distance at camera scale %s",
  (scale) => {
    const e = new SnapEngine(precisionProject()),
      q = query([0, 0.05, 0], scale);
    expect(e.query(q).candidates.some((c) => c.kind === "endpoint")).toBe(
      scale * 0.05 <= 16,
    );
  },
);
it("holds an acquired snap to the release radius and releases it beyond that", () => {
  const e = new SnapEngine(precisionProject());
  e.query(query([0, 0, 0]));
  expect(e.query(query([0.12, 0.02, 0])).candidate?.kind).toBe("endpoint");
  expect(e.query(query([0.3, 0.02, 0])).candidate?.kind).toBe("edge");
});
it("supports grid, locked axes, parallel and perpendicular inference", () => {
  const e = new SnapEngine(precisionProject());
  const q = query([1.01, 2.01, 0]);
  q.gridStep = 1;
  expect(
    e
      .query(q)
      .candidates.some(
        (c) => c.kind === "grid" && c.point[0] === 1 && c.point[1] === 2,
      ),
  ).toBe(true);
  e.query(query([1, 0, 0]));
  const aligned = query([2, 2, 0]);
  aligned.anchor = [1, 2, 0];
  expect(e.query(aligned).candidates.some((c) => c.kind === "parallel")).toBe(
    true,
  );
  aligned.anchor = [2, 1, 0];
  expect(
    e.query(aligned).candidates.some((c) => c.kind === "perpendicular"),
  ).toBe(true);
  aligned.axis = 0;
  const r = e.query(aligned);
  expect(r.candidate?.point[1]).toBe(1);
});
it("prioritizes visible front-face candidates over hidden topology behind the face", () => {
  const p = topologyProject(),
    g = Object.values(p.geometries)[0];
  g.vertices["behind"] = { id: id("behind"), position: [3, 1.5, -1] };
  expect(new SnapEngine(p).query(query([3, 1.5, 0])).candidate?.kind).toBe(
    "face",
  );
});
it("bounds local pair work and prunes a large spatially distributed scene", () => {
  const p = precisionProject(),
    g = emptyGeometry(id("many"), id(p.rootDefinitionId));
  for (let i = 0; i < 10000; i++) {
    const a = id<"vertex">(`a${i}`),
      b = id<"vertex">(`b${i}`),
      e = id<"edge">(`e${i}`);
    g.vertices[a] = { id: a, position: [i * 10, 0, 0] };
    g.vertices[b] = { id: b, position: [i * 10 + 2, 0, 0] };
    g.edges[e] = { id: e, start: a, end: b, curve: { kind: "line" } };
  }
  p.geometries = { many: g };
  p.definitions[p.rootDefinitionId].geometryId = g.id;
  const engine = new SnapEngine(p);
  engine.query(query([50000, 0, 0]));
  expect(engine.sourceCount).toBe(30000);
  expect(engine.stats.tested).toBeLessThan(30);
  expect(engine.stats.visited).toBeLessThan(100);
  expect(engine.stats.pairs).toBeLessThanOrEqual(2016);
});
it("keeps an exact point physical when display units change and rejects bad input without changing the document/history", () => {
  const p = precisionProject();
  useEditor.getState().replace(p);
  const before = useEditor.getState();
  expect(
    usePrecision.getState().submit(p, "2,5 м;0;0", "coordinates", false),
  ).toBe(true);
  const target = usePrecision.getState().target;
  p.units = "mm";
  expect(formatDimension(target![0], p.units)).toBe("2500 mm");
  expect(usePrecision.getState().submit(p, "bad", "coordinates", false)).toBe(
    false,
  );
  expect(usePrecision.getState().target).toEqual(target);
  expect(useEditor.getState().project).toEqual(before.project);
  expect(useEditor.getState().canUndo).toBe(before.canUndo);
});
it("commits a precise endpoint through the real editor, roundtrips and restores its ID with Undo/Redo", async () => {
  const p = precisionProject(),
    g = Object.values(p.geometries)[0],
    v = Object.values(g.vertices).find((v) => v.position[0] === 4)!;
  useEditor.getState().replace(p);
  const ref = {
    definitionId: p.rootDefinitionId,
    geometryId: g.id,
    kind: "vertex" as const,
    entityId: v.id,
    occurrencePath: [],
  };
  expect(
    usePrecision
      .getState()
      .submit(p, "4000,125 мм; 0; 0", "coordinates", false),
  ).toBe(true);
  expect(
    (
      await useEditor.getState().editGeometry(ref, {
        kind: "move-vertices",
        positions: [
          { vertexId: v.id, position: usePrecision.getState().target! },
        ],
      })
    ).status,
  ).toBe("applied");
  const after = useEditor.getState().project as ProjectV2;
  validateProject(after);
  expect(after.geometries[g.id].vertices[v.id].position[0]).toBe(4.000125);
  expect(canonical(parseProject(serializeProject(after)))).toBe(
    canonical(after),
  );
  useEditor.getState().undo();
  expect(useEditor.getState().project).toEqual(p);
  useEditor.getState().redo();
  expect(useEditor.getState().project).toEqual(after);
});
it("clears stale selection and precision state only after accepting a replacement document", () => {
  const p = precisionProject(),
    g = Object.values(p.geometries)[0];
  useEditor.getState().replace(p);
  useEditor.getState().selectEntity({
    definitionId: p.rootDefinitionId,
    geometryId: g.id,
    entityId: Object.keys(g.vertices)[0],
    kind: "vertex",
    occurrencePath: [],
  });
  usePrecision.getState().configure({ enabled: true });
  usePrecision.getState().submit(p, "1;2;3", "coordinates", false);
  const invalid = structuredClone(p);
  invalid.rootDefinitionId = "missing";
  expect(useEditor.getState().replace(invalid).status).toBe("rejected");
  expect(usePrecision.getState().target).toEqual([1, 2, 3]);
  expect(useEditor.getState().replace(topologyProject()).status).toBe(
    "applied",
  );
  expect(useEditor.getState().topologySelection).toBeNull();
  expect(usePrecision.getState().target).toBeNull();
  expect(usePrecision.getState().enabled).toBe(false);
});
it("does not accept numeric additions below Float64 resolution", () => {
  expect(() =>
    resolvePrecision({
      ...base(),
      anchor: [1e9, 0, 0],
      relative: true,
      text: "1e-20;0;0",
    }),
  ).toThrow(/точности/);
  expect(() =>
    resolvePrecision({
      ...base(),
      anchor: [1e9, 0, 0],
      mode: "length",
      text: "1e-20",
    }),
  ).toThrow(/точности/);
  expect(() => parseDimension("1.1234567890123456789", "m")).toThrow(/17/);
});
it("rejects invalid queries and parallel-plane rays without producing nonfinite targets", () => {
  const engine = new SnapEngine(precisionProject());
  expect(() =>
    engine.query({ ...query([0, 0, 0]), cursor: [NaN, 0] }),
  ).toThrow();
  expect(() => engine.query({ ...query([0, 0, 0]), gridStep: NaN })).toThrow();
  const q = query([10, 10, 0]);
  q.enabled = false;
  q.ray.direction = [1, 0, 0];
  expect(engine.query(q).raw).toBeNull();
  expect(engine.query(q).candidate).toBeNull();
});
it("keeps snap source geometry isolated from callers mutating returned DTOs", () => {
  const engine = new SnapEngine(precisionProject()),
    result = engine.query(query([0, 0, 0]));
  result.candidate!.point[0] = 100;
  result.candidate!.ref!.occurrencePath.push("invalid");
  const next = engine.query(query([0, 0, 0]));
  expect(next.candidate!.point).toEqual([0, 0, 0]);
  expect(next.candidate!.ref!.occurrencePath).toEqual([]);
});
it("does not use distant scene extents to invent a near-skew intersection", () => {
  const p = precisionProject([
    [
      [-1, 0, 0],
      [1, 0, 0],
    ],
    [
      [0, -1, 0.00001],
      [0, 1, 0.00001],
    ],
  ]);
  const g = Object.values(p.geometries)[0];
  g.vertices["far"] = { id: id("far"), position: [1e9, 0, 0] };
  // A distant *separate* occurrence must not change this wire's tolerance.
  delete g.vertices.far;
  const other = emptyGeometry(id("far-geometry"), id("far-definition"));
  other.vertices["far"] = { id: id("far"), position: [1e9, 0, 0] };
  p.geometries[other.id] = other;
  p.definitions["far-definition"] = {
    id: id("far-definition"),
    name: "Far",
    kind: "group",
    geometryId: other.id,
    childNodeIds: [],
  };
  p.nodes["far-instance"] = {
    id: id("far-instance"),
    name: "Far",
    kind: "group",
    parentDefinitionId: id(p.rootDefinitionId),
    definitionId: id("far-definition"),
    visible: true,
    locked: false,
    transform: {
      translation: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    },
  };
  p.definitions[p.rootDefinitionId].childNodeIds.push(id("far-instance"));
  expect(
    new SnapEngine(p)
      .query(query([0, 0, 0]))
      .candidates.some((c) => c.kind === "intersection"),
  ).toBe(false);
});
it("does not snap to a vertex only one micron behind an opaque face", () => {
  const p = topologyProject(),
    g = Object.values(p.geometries)[0];
  g.vertices["behind-near"] = {
    id: id("behind-near"),
    position: [3, 1.5, -0.000001],
  };
  expect(new SnapEngine(p).query(query([3, 1.5, 0])).candidate?.kind).toBe(
    "face",
  );
});
it.each([
  [[-2, 0, 0], [2, 0, 5], 0.25],
  [[-1, 0, 11], [1, 0, 0], 0.7],
] as [Vec3, Vec3, number][])(
  "uses perspective-correct on-edge interpolation and clips near-plane crossings",
  (a, b, t) => {
    const p = precisionProject([[a, b]]),
      engine = new SnapEngine(p),
      camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const project = (v: Vec3) => {
      const view = new THREE.Vector3(...v).applyMatrix4(
          camera.matrixWorldInverse,
        ),
        clip = new THREE.Vector4(view.x, view.y, view.z, 1).applyMatrix4(
          camera.projectionMatrix,
        ),
        point = new THREE.Vector3(...v).project(camera);
      return {
        x: point.x * 500,
        y: point.y * 500,
        depth: -view.z,
        w: clip.w,
        clipZ: point.z,
        nearPlane: clip.z + clip.w,
        farPlane: clip.w - clip.z,
        visible: view.z < 0 && point.z >= -1 - 1e-12 && point.z <= 1,
      };
    };
    const point = a.map((n, i) => n + (b[i] - n) * t) as Vec3,
      pixel = project(point),
      direction = new THREE.Vector3(...point)
        .sub(camera.position)
        .normalize()
        .toArray() as Vec3;
    const q = {
      ...query(point),
      project,
      cursor: [pixel.x, pixel.y] as [number, number],
      perspective: true,
      ray: { origin: [0, 0, 10] as Vec3, direction },
    };
    const candidate = engine.query(q).candidates.find((c) => c.kind === "edge");
    expect(candidate).toBeDefined();
    candidate!.point.forEach((n, i) => expect(n).toBeCloseTo(point[i], 11));
  },
);
it("fails closed with an explicit density diagnostic instead of selecting from a partially searched scene", () => {
  const p = precisionProject(),
    g = emptyGeometry(id("dense"), id(p.rootDefinitionId));
  for (let i = 0; i < 11000; i++) {
    const key = id<"vertex">(`v${i}`);
    g.vertices[key] = { id: key, position: [0, 0, -i] };
  }
  p.geometries = { dense: g };
  p.definitions[p.rootDefinitionId].geometryId = g.id;
  const engine = new SnapEngine(p),
    result = engine.query(query([0, 0, 0]));
  expect(engine.stats.truncated).toBe(true);
  expect(engine.stats.inspected).toBeLessThanOrEqual(10000);
  expect(result.candidate).toBeNull();
  expect(result.raw).toBeNull();
});
it("keeps unrelated component geometry and node placement unchanged during a precise root edit", async () => {
  const p = componentProject(),
    wire = Object.values(precisionProject().geometries)[0];
  wire.ownerDefinitionId = id(p.rootDefinitionId);
  p.geometries[wire.id] = wire;
  p.definitions[p.rootDefinitionId].geometryId = wire.id;
  validateProject(p);
  const native = structuredClone(p.geometries["native/geometry"]),
    v = Object.values(wire.vertices)[0];
  useEditor.getState().replace(p);
  const result = await useEditor.getState().editGeometry(
    {
      definitionId: p.rootDefinitionId,
      geometryId: wire.id,
      entityId: v.id,
      kind: "vertex",
      occurrencePath: [],
    },
    {
      kind: "move-vertices",
      positions: [{ vertexId: v.id, position: [-1.234567, 0, 0] }],
    },
  );
  expect(result.status).toBe("applied");
  const after = useEditor.getState().project as ProjectV2;
  expect(after.geometries["native/geometry"]).toEqual(native);
  expect(after.nodes).toEqual(p.nodes);
});
it("reproduces the published numerical examples and loads the demonstration v2 project", () => {
  const examples = createPrecisionExamples();
  expect(JSON.parse(JSON.stringify(examples.examples))).toEqual(
    JSON.parse(readFileSync("docs/0.2/S5_EXAMPLES.json", "utf8")),
  );
  const doc = parseProject(
    readFileSync("tests/fixtures/v2/precision.v3d", "utf8"),
  );
  expect(doc).toEqual(parseProject(examples.project));
});
it("allows an explicit work plane from a face and resets it on context changes", () => {
  const plane = workPlane("XY");
  plane.origin = [0, 0, 2];
  usePrecision.getState().configure({ planeOverride: plane, system: "plane" });
  expect(
    usePrecision
      .getState()
      .submit(precisionProject(), "1;2;0", "coordinates", false),
  ).toBe(true);
  expect(usePrecision.getState().target).toEqual([1, 2, 2]);
  usePrecision.getState().configure({ path: [] });
  expect(usePrecision.getState().planeOverride).toBeNull();
});
