import { beforeEach, expect, it } from "vitest";
import {
  createLocalGeometryBackend,
  emptyGeometry,
  GeometrySession,
  id,
  prepareSketch,
  scaledPosition,
  validatePrepared,
  type GeometryModel,
  type Vec3,
} from "@forma/geometry";
import { emptyProjectV2 } from "@forma/document";
import { useEditor } from "@forma/editor";
import { precisionProject } from "./fixtures/precision-project";

function make() {
  const p = emptyProjectV2("Масштабирование"),
    gid = id<"geometry">("scale/geometry"),
    context = {
      ownerDefinitionId: p.rootDefinitionId,
      materialIds: new Set<string>(),
    };
  let g: GeometryModel = emptyGeometry(gid, id(p.rootDefinitionId));
  g = validatePrepared(
    g,
    prepareSketch(
      g,
      {
        kind: "insert-segments",
        segments: [
          [
            [0, 0, 0],
            [4, 0, 0],
          ],
        ],
        plane: null,
      },
      context,
      id("scale/seed"),
    ),
    context,
    id("scale/seed"),
  );
  p.geometries[gid] = g;
  p.definitions[p.rootDefinitionId].geometryId = gid;
  return { p, g, context };
}

beforeEach(() => useEditor.getState().replace(precisionProject()));

it("scales a real wire vertex about a numeric origin and restores exact topology through session history", async () => {
  const { g, context } = make(),
    session = new GeometrySession(
      g,
      context,
      createLocalGeometryBackend(context),
      id("scale/session"),
    ),
    intent = {
      kind: "scale-vertices" as const,
      vertexIds: ["scale/seed/vertex/1"],
      origin: [0, 0, 0] as Vec3,
      factors: [2, 1, 1] as Vec3,
    },
    before = JSON.stringify(session.snapshot);
  const preview = await session.prepare(intent);
  expect(preview.status).toBe("preview");
  if (preview.status !== "preview") throw Error("preview");
  expect(preview.model.vertices["scale/seed/vertex/1"].position).toEqual([
    8, 0, 0,
  ]);
  expect(Object.keys(preview.model.vertices)).toEqual(Object.keys(g.vertices));
  expect(Object.keys(preview.model.edges)).toEqual(Object.keys(g.edges));
  expect(JSON.stringify(session.snapshot)).toBe(before);
  expect(await session.execute(intent, "commit")).toMatchObject({
    status: "applied",
  });
  const scaled = JSON.stringify(session.snapshot);
  expect((await session.undo()).status).toBe("applied");
  expect(JSON.stringify(session.snapshot)).toBe(before);
  expect((await session.redo()).status).toBe("applied");
  expect(JSON.stringify(session.snapshot)).toBe(scaled);
});

it.each([
  [0, 1, 1],
  [-1, 1, 1],
  [Number.NaN, 1, 1],
  [Number.POSITIVE_INFINITY, 1, 1],
  [1e7, 1, 1],
])("rejects invalid scale factors atomically: %j", async (...factors) => {
  const { g, context } = make(),
    session = new GeometrySession(
      g,
      context,
      createLocalGeometryBackend(context),
      id("scale/invalid"),
    );
  const result = await session.prepare({
    kind: "scale-vertices",
    vertexIds: ["scale/seed/vertex/1"],
    origin: [0, 0, 0],
    factors: factors as Vec3,
  });
  expect(result.status).toBe("error");
  expect(session.snapshot).toEqual(g);
});

it("applies topology scaling in the common document history", async () => {
  const { p, g } = make();
  useEditor.getState().replace(p);
  const ref = {
    definitionId: p.rootDefinitionId,
    geometryId: g.id,
    kind: "vertex" as const,
    entityId: "scale/seed/vertex/1",
    occurrencePath: [],
  };
  useEditor.getState().selectEntity(ref);
  expect(
    await useEditor.getState().editGeometry(ref, {
      kind: "scale-vertices",
      vertexIds: [ref.entityId],
      origin: [0, 0, 0],
      factors: [2, 1, 1],
    }),
  ).toMatchObject({ status: "applied" });
  const scaled = useEditor.getState().project;
  expect(useEditor.getState().canUndo).toBe(true);
  useEditor.getState().undo();
  expect(useEditor.getState().project).toEqual(p);
  useEditor.getState().redo();
  expect(useEditor.getState().project).toEqual(scaled);
});

it("scales coordinate offsets componentwise around a non-origin anchor", () => {
  expect(scaledPosition([5, 4, 3], [1, 2, 3], [2, 0.5, 1])).toEqual([9, 3, 3]);
});
