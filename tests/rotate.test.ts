import { beforeEach, expect, it } from "vitest";
import {
  GeometrySession,
  createLocalGeometryBackend,
  id,
  type GeometryModel,
  type Vec3,
} from "@forma/geometry";
import {
  emptyGeometry,
  prepareSketch,
  validatePrepared,
} from "@forma/geometry";
import { emptyProjectV2 } from "@forma/document";
import { useEditor } from "@forma/editor";
import { precisionProject } from "./fixtures/precision-project";
function make() {
  const p = emptyProjectV2("Вращение"),
    gid = id<"geometry">("rotate/geometry"),
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
            [2, 0, 0],
          ],
        ],
        plane: null,
      },
      context,
      id("rotate/seed"),
    ),
    context,
    id("rotate/seed"),
  );
  p.geometries[gid] = g;
  p.definitions[p.rootDefinitionId].geometryId = gid;
  return { p, g, context };
}
beforeEach(() => useEditor.getState().replace(precisionProject()));
it("rotates an actual wire vertex by Rodrigues transform and restores exact IDs with GeometrySession undo/redo", async () => {
  const { g, context } = make(),
    session = new GeometrySession(
      g,
      context,
      createLocalGeometryBackend(context),
      id("rotate/session"),
    );
  const intent = {
    kind: "rotate-vertices" as const,
    vertexIds: ["rotate/seed/vertex/1"],
    origin: [0, 0, 0] as Vec3,
    axis: [0, 0, 1] as Vec3,
    angle: Math.PI / 2,
  };
  const before = JSON.stringify(session.snapshot);
  const result = await session.prepare(intent);
  expect(result.status).toBe("preview");
  if (result.status !== "preview") throw Error("preview");
  expect(result.model.vertices["rotate/seed/vertex/0"].position).toEqual([
    0, 0, 0,
  ]);
  expect(result.model.vertices["rotate/seed/vertex/1"].position[0]).toBeCloseTo(
    0,
    10,
  );
  expect(result.model.vertices["rotate/seed/vertex/1"].position[1]).toBeCloseTo(
    2,
    10,
  );
  expect(result.model.vertices["rotate/seed/vertex/1"].position[2]).toBeCloseTo(
    0,
    10,
  );
  expect(Object.keys(result.model.edges)).toEqual(Object.keys(g.edges));
  expect(JSON.stringify(session.snapshot)).toBe(before);
  expect(await session.execute(intent, "commit")).toMatchObject({
    status: "applied",
  });
  const rotated = JSON.stringify(session.snapshot);
  expect((await session.undo()).status).toBe("applied");
  expect(JSON.stringify(session.snapshot)).toBe(before);
  expect((await session.redo()).status).toBe("applied");
  expect(JSON.stringify(session.snapshot)).toBe(rotated);
});
it.each([
  { name: "zero axis", origin: [0, 0, 0], axis: [0, 0, 0], angle: 1 },
  {
    name: "out-of-range angle",
    origin: [0, 0, 0],
    axis: [0, 0, 1],
    angle: 1e9,
  },
  { name: "NaN angle", origin: [0, 0, 0], axis: [0, 0, 1], angle: NaN },
  {
    name: "infinite angle",
    origin: [0, 0, 0],
    axis: [0, 0, 1],
    angle: Infinity,
  },
  { name: "non-finite center", origin: [NaN, 0, 0], axis: [0, 0, 1], angle: 1 },
])(
  "rejects $name without changing geometry",
  async ({ origin, axis, angle }) => {
    const { g, context } = make(),
      session = new GeometrySession(
        g,
        context,
        createLocalGeometryBackend(context),
        id("rotate/session-invalid"),
      );
    const result = await session.prepare({
      kind: "rotate-vertices",
      vertexIds: ["rotate/seed/vertex/0"],
      origin: origin as Vec3,
      axis: axis as Vec3,
      angle: angle as number,
    });
    expect(result.status).toBe("error");
    expect(session.snapshot).toEqual(g);
  },
);
it("editor applies rotation in shared document history and undo restores saved topology", async () => {
  const { p, g } = make();
  useEditor.getState().replace(p);
  const ref = {
    definitionId: p.rootDefinitionId,
    geometryId: g.id,
    kind: "vertex" as const,
    entityId: "rotate/seed/vertex/1",
    occurrencePath: [],
  };
  useEditor.getState().selectEntity(ref);
  expect(
    await useEditor.getState().editGeometry(
      ref,
      {
        kind: "rotate-vertices",
        vertexIds: ["rotate/seed/vertex/1"],
        origin: [0, 0, 0],
        axis: [0, 0, 1],
        angle: Math.PI / 2,
      },
      undefined,
      "Вращение вершин",
    ),
  ).toMatchObject({ status: "applied" });
  const rotated = useEditor.getState().project;
  expect(useEditor.getState().canUndo).toBe(true);
  useEditor.getState().undo();
  expect(useEditor.getState().project).toEqual(p);
  useEditor.getState().redo();
  expect(useEditor.getState().project).toEqual(rotated);
});
