import { beforeEach, expect, it } from "vitest";
import {
  createLocalGeometryBackend,
  GeometrySession,
  id,
  classifyBody,
  mirroredPosition,
  prepareVertexMirror,
  validatePrepared,
  type Vec3,
} from "@forma/geometry";
import { useEditor } from "@forma/editor";
import { precisionProject } from "./fixtures/precision-project";
import { sheet, tetrahedron, topologyContext, wire } from "./fixtures/topology";

beforeEach(() => useEditor.getState().replace(precisionProject()));

it("reflects a selected wire vertex across a numeric plane and preserves topology IDs", () => {
  const model = wire(),
    context = topologyContext,
    change = prepareVertexMirror(
      model,
      ["v/1"],
      [0, 0, 0],
      [1, 0, 0],
      context,
      id("mirror/wire"),
    ),
    mirrored = validatePrepared(model, change, context, id("mirror/wire"));
  expect(mirrored.vertices["v/1"].position).toEqual([-2, 0, 0]);
  expect(Object.keys(mirrored.vertices)).toEqual(Object.keys(model.vertices));
  expect(Object.keys(mirrored.edges)).toEqual(Object.keys(model.edges));
});

it("reflects a complete face, keeps its area and preserves front/back materials", () => {
  const model = sheet(),
    face = model.faces["f/0"],
    beforeNormal = face.plane.normal,
    context = {
      ...topologyContext,
      materialIds: new Set(["material/front", "material/back"]),
    };
  face.frontMaterialId = id("material/front");
  face.backMaterialId = id("material/back");
  const change = prepareVertexMirror(
    model,
    Object.keys(model.vertices),
    [0, 0, 0],
    [0, 1, 0],
    context,
    id("mirror/face"),
  );
  const mirrored = validatePrepared(model, change, context, id("mirror/face")),
    reflectedFace = mirrored.faces["f/0"];
  expect(mirrored.vertices["v/1"].position).toEqual([2, 0, 0]);
  expect(reflectedFace.frontMaterialId).toBe("material/front");
  expect(reflectedFace.backMaterialId).toBe("material/back");
  expect(
    reflectedFace.plane.normal.reduce(
      (sum, value, i) => sum + value * beforeNormal[i],
      0,
    ),
  ).toBeLessThan(0);
  expect(Object.keys(mirrored.faces)).toEqual(Object.keys(model.faces));
});

it("preserves a mirrored closed shell by reversing each face boundary", () => {
  const model = tetrahedron(),
    change = prepareVertexMirror(
      model,
      Object.keys(model.vertices),
      [0, 0, 0],
      [1, 0, 0],
      topologyContext,
      id("mirror/solid"),
    ),
    mirrored = validatePrepared(
      model,
      change,
      topologyContext,
      id("mirror/solid"),
    );
  expect(classifyBody(mirrored, "body/0")).toBe("closed-shell");
  expect(
    mirrored.shells["shell/0"].faces.every((use) => use.orientation === 1),
  ).toBe(true);
});

it("rejects partial face reflection atomically and GeometrySession undo/redo restores exact IDs", async () => {
  const model = sheet(),
    session = new GeometrySession(
      model,
      topologyContext,
      createLocalGeometryBackend(topologyContext),
      id("mirror/session"),
    ),
    before = JSON.stringify(session.snapshot),
    bad = await session.prepare({
      kind: "mirror-vertices",
      vertexIds: ["v/1"],
      origin: [0, 0, 0],
      normal: [1, 0, 0],
    });
  expect(bad.status).toBe("error");
  expect(JSON.stringify(session.snapshot)).toBe(before);
  const intent = {
    kind: "mirror-vertices" as const,
    vertexIds: Object.keys(model.vertices),
    origin: [0, 0, 0] as Vec3,
    normal: [1, 0, 0] as Vec3,
  };
  expect((await session.prepare(intent)).status).toBe("preview");
  expect(JSON.stringify(session.snapshot)).toBe(before);
  expect(await session.execute(intent, "commit")).toMatchObject({
    status: "applied",
  });
  const result = JSON.stringify(session.snapshot);
  expect((await session.undo()).status).toBe("applied");
  expect(JSON.stringify(session.snapshot)).toBe(before);
  expect((await session.redo()).status).toBe("applied");
  expect(JSON.stringify(session.snapshot)).toBe(result);
});

it.each([
  {
    point: [2, 1, -3] as Vec3,
    origin: [0, 0, 0] as Vec3,
    normal: [1, 0, 0] as Vec3,
    expected: [-2, 1, -3],
  },
  {
    point: [4, 2, 3] as Vec3,
    origin: [0, 2, 0] as Vec3,
    normal: [0, 5, 0] as Vec3,
    expected: [4, 2, 3],
  },
])(
  "computes plane reflection for $point",
  ({ point, origin, normal, expected }) => {
    expect(mirroredPosition(point, origin, normal)).toEqual(expected);
  },
);
