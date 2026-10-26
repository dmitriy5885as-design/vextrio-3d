import { expect, it, beforeEach, vi } from "vitest";
import {
  ToolController,
  sketchSegments,
  type ToolHost,
  type SketchReply,
} from "@forma/tools";
import { useEditor, usePrecision, sketchController } from "@forma/editor";
import {
  emptyProjectV2,
  emptyProject,
  validateProject,
  parseProject,
  serializeProject,
  type ProjectV2,
} from "@forma/document";
import { canonical, tessellateFace, type Vec3 } from "@forma/geometry";
import { workPlane } from "@forma/snapping";
import { SnapEngine } from "@forma/snapping";
import { componentProject } from "./fixtures/v2-project";
const plane = workPlane("XZ"),
  rectangle: [Vec3, Vec3][] = [
    [
      [0, 0, 0],
      [4, 0, 0],
    ],
    [
      [4, 0, 0],
      [4, 0, 3],
    ],
    [
      [4, 0, 3],
      [0, 0, 3],
    ],
    [
      [0, 0, 3],
      [0, 0, 0],
    ],
  ];
it("drawing in a nonuniformly scaled occurrence keeps physical rectangle area", async () => {
  const p = componentProject(),
    node = p.nodes["instance/group"];
  if (node.kind === "legacy-primitive") throw Error("fixture");
  node.transform.scale = [2, 1, 3];
  useEditor.getState().replace(p);
  const result = await useEditor
    .getState()
    .drawSegments(["instance/group"], rectangle);
  expect(result.status).toBe("applied");
  if (result.status !== "rejected")
    expect(result.stats?.areas[0]).toBeCloseTo(12, 10);
});
it("Undo cancels uncommitted drawing even when the history is empty", async () => {
  useEditor.getState().setTool("line");
  await sketchController.click([0, 0, 0], plane, "start");
  expect(sketchController.state.start).not.toBeNull();
  expect(useEditor.getState().undo().status).toBe("noop");
  expect(sketchController.state.start).toBeNull();
});
beforeEach(() => {
  useEditor.getState().setTool("select");
  useEditor.getState().replace(emptyProjectV2());
  usePrecision
    .getState()
    .configure({ planeName: "XZ", system: "world", path: [] });
});
it("display-unit changes preserve the uncommitted world-space start point", async () => {
  useEditor.getState().setTool("rectangle");
  await sketchController.click([1, 0, 2], plane, "start");
  useEditor.getState().mutate("Units", (p) => {
    p.units = "mm";
  });
  expect(sketchController.state.start).toEqual([1, 0, 2]);
  expect(
    Object.keys((useEditor.getState().project as ProjectV2).geometries),
  ).toHaveLength(0);
});
it("keeps an explicitly chosen face working plane when activating a drawing tool in the same context", () => {
  const custom = workPlane("XY");
  usePrecision.getState().configure({ enabled: true, planeOverride: custom });
  useEditor.getState().setTool("line");
  expect(usePrecision.getState().planeOverride).toBe(custom);
  sketchController.cancel();
});
it("captures the exact work-plane origin and grid nodes rather than a rounded-pixel free axis point", () => {
  const engine = new SnapEngine(emptyProjectV2()),
    query = (x: number) => ({
      cursor: [x * 100, 0] as [number, number],
      project: (p: Vec3) => ({
        x: p[0] * 100,
        y: p[2] * 100,
        depth: 10 - p[1],
        visible: true,
        w: 1,
      }),
      ray: { origin: [x, 10, 0] as Vec3, direction: [0, -1, 0] as Vec3 },
      plane,
      anchor: [0, 0, 0] as Vec3,
      axes: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ] as Vec3[],
      gridStep: 0.25,
      enabled: true,
    });
  expect(engine.query(query(-0.018)).candidate?.point).toEqual([0, 0, 0]);
  engine.reset();
  expect(engine.query(query(4.018)).candidate?.point).toEqual([4, 0, 0]);
});
it("the idle drawing controller does not clear an S5 exact target on a display-unit edit", () => {
  const p = useEditor.getState().project as ProjectV2;
  usePrecision.getState().configure({ enabled: true });
  usePrecision.getState().submit(p, "2.5m;0;0", "coordinates", false);
  useEditor.getState().mutate("Units", (p) => {
    p.units = "mm";
  });
  expect(usePrecision.getState().target).toEqual([2.5, 0, 0]);
});
it("creates real rectangle topology in an empty document atomically, and Undo removes the first geometry and material", async () => {
  const before = useEditor.getState().project;
  expect((await useEditor.getState().drawSegments([], rectangle)).status).toBe(
    "applied",
  );
  const after = useEditor.getState().project as ProjectV2,
    g = Object.values(after.geometries)[0];
  expect(Object.keys(g.edges)).toHaveLength(4);
  expect(Object.keys(g.faces)).toHaveLength(1);
  expect(tessellateFace(g, Object.values(g.faces)[0]).area).toBe(12);
  validateProject(after);
  expect(canonical(parseProject(serializeProject(after)))).toBe(
    canonical(after),
  );
  useEditor.getState().undo();
  expect(useEditor.getState().project).toEqual(before);
  useEditor.getState().redo();
  expect(useEditor.getState().project).toEqual(after);
});
it("previews real S3 intersections and faces without changing document, dirty-state or history", async () => {
  const state = useEditor.getState(),
    before = state.project,
    saved = state.savedSignature;
  const result = await state.drawSegments([], rectangle, true);
  expect(result.status).toBe("preview");
  if (result.status !== "rejected") expect(result.stats?.areas).toEqual([12]);
  expect(useEditor.getState().project).toBe(before);
  expect(useEditor.getState().savedSignature).toBe(saved);
  expect(useEditor.getState().canUndo).toBe(false);
});
it("a diagonal splits the drawn rectangle into two independent six square metre faces with reversible IDs", async () => {
  await useEditor.getState().drawSegments([], rectangle);
  const before = useEditor.getState().project;
  const result = await useEditor.getState().drawSegments(
    [],
    [
      [
        [0, 0, 0],
        [4, 0, 3],
      ],
    ],
  );
  expect(result.status).toBe("applied");
  const after = useEditor.getState().project as ProjectV2,
    g = Object.values(after.geometries)[0];
  expect(Object.values(g.faces).map((f) => tessellateFace(g, f).area)).toEqual([
    6, 6,
  ]);
  useEditor.getState().undo();
  expect(useEditor.getState().project).toEqual(before);
  useEditor.getState().redo();
  expect(useEditor.getState().project).toEqual(after);
});
it("crossing strokes split existing edges and a duplicate stroke is a no-op", async () => {
  await useEditor.getState().drawSegments(
    [],
    [
      [
        [0, 0, 0],
        [4, 0, 0],
      ],
    ],
  );
  const before = useEditor.getState().project;
  expect(
    (
      await useEditor.getState().drawSegments(
        [],
        [
          [
            [4, 0, 0],
            [0, 0, 0],
          ],
        ],
      )
    ).status,
  ).toBe("noop");
  expect(useEditor.getState().project).toBe(before);
  await useEditor.getState().drawSegments(
    [],
    [
      [
        [2, 0, -1],
        [2, 0, 1],
      ],
    ],
  );
  const p = useEditor.getState().project as ProjectV2,
    g = Object.values(p.geometries)[0];
  expect(Object.keys(g.vertices)).toHaveLength(5);
  expect(Object.keys(g.edges)).toHaveLength(4);
});
it("invalid geometry and cancelled async requests leave the document and both history branches unchanged", async () => {
  await useEditor.getState().drawSegments([], rectangle);
  useEditor.getState().undo();
  const before = useEditor.getState();
  expect(
    (
      await useEditor.getState().drawSegments(
        [],
        [
          [
            [0, 0, 0],
            [0, 0, 0],
          ],
        ],
      )
    ).status,
  ).toBe("rejected");
  let active = true;
  const request = useEditor
    .getState()
    .drawSegments([], rectangle, false, () => active);
  active = false;
  expect((await request).status).toBe("rejected");
  expect(useEditor.getState().project).toBe(before.project);
  expect(useEditor.getState().canRedo).toBe(true);
  expect(useEditor.getState().savedSignature).toBe(before.savedSignature);
});
it("continues a polyline and closes a real face via the common controller", async () => {
  useEditor.getState().setTool("line");
  const points: Vec3[] = [
    [0, 0, 0],
    [4, 0, 0],
    [4, 0, 3],
    [0, 0, 3],
    [0, 0, 0],
  ];
  for (let i = 0; i < points.length; i++)
    await sketchController.click(points[i], plane, "point/" + i);
  expect(sketchController.state.phase).toBe("Finish");
  const p = useEditor.getState().project as ProjectV2;
  expect(Object.keys(Object.values(p.geometries)[0].faces)).toHaveLength(1);
});
it("rejects v1 drawing without silently migrating or changing tools", async () => {
  useEditor.getState().replace(emptyProject());
  useEditor.getState().setTool("rectangle");
  expect(useEditor.getState().tool).toBe("select");
  expect((await useEditor.getState().drawSegments([], rectangle)).status).toBe(
    "rejected",
  );
  expect(useEditor.getState().project.schemaVersion).toBe(1);
});
it("draws in a nested group without modifying other context geometry and requires shared acknowledgement", async () => {
  const p = componentProject(),
    before = structuredClone(p.geometries);
  useEditor.getState().replace(p);
  expect(
    (await useEditor.getState().drawSegments(["instance/group"], rectangle))
      .status,
  ).toBe("applied");
  const after = useEditor.getState().project as ProjectV2;
  expect(after.geometries["native/geometry"]).toEqual(
    before["native/geometry"],
  );
  expect(after.nodes).toEqual(p.nodes);
  expect(
    (await useEditor.getState().drawSegments(["instance/two"], rectangle))
      .status,
  ).toBe("rejected");
});
it("supports path-sensitive Shift selection and removes it on history/document changes", async () => {
  const p = componentProject(),
    g = Object.values(p.geometries)[0],
    entityId = Object.keys(g.faces)[0],
    base = {
      kind: "face" as const,
      definitionId: g.ownerDefinitionId,
      geometryId: g.id,
      entityId,
    };
  useEditor.getState().replace(p);
  useEditor
    .getState()
    .selectEntity({ ...base, occurrencePath: ["instance/two"] });
  useEditor
    .getState()
    .selectEntity(
      { ...base, occurrencePath: ["instance/group", "instance/one"] },
      true,
    );
  expect(useEditor.getState().topologySelections).toHaveLength(2);
  useEditor
    .getState()
    .selectEntity({ ...base, occurrencePath: ["instance/two"] }, true);
  expect(useEditor.getState().topologySelections).toHaveLength(1);
  useEditor.getState().selectEntity(null);
  expect(useEditor.getState().topologySelections).toHaveLength(0);
});
it("rectangle helper supports signed corners and rejects collapsed or off-plane shapes", () => {
  expect(
    sketchSegments("rectangle", [0, 0, 0], [-4, 0, -3], plane),
  ).toHaveLength(4);
  expect(() =>
    sketchSegments("rectangle", [0, 0, 0], [4, 1, 3], plane),
  ).toThrow(/плоскости/);
  expect(() =>
    sketchSegments("rectangle", [0, 0, 0], [4, 0, 0], plane),
  ).toThrow(/Ширина/);
});
it("suppresses duplicate events and cancellation while a commit is pending", async () => {
  let finish: (
    value: Awaited<ReturnType<ToolHost["commit"]>>,
  ) => void = () => {};
  const host: ToolHost = {
      preview: async () => ({ status: "preview" }),
      commit: vi.fn(
        () => new Promise<SketchReply>((resolve) => (finish = resolve)),
      ),
    },
    controller = new ToolController(host);
  controller.activate("line");
  await controller.click([0, 0, 0], plane, "one");
  await controller.click([0, 0, 0], plane, "one");
  expect(controller.state.phase).toBe("Start");
  const commit = controller.click([1, 0, 0], plane, "two");
  await controller.click([1, 0, 0], plane, "three");
  expect(host.commit).toHaveBeenCalledTimes(1);
  controller.cancel();
  finish({ status: "applied" });
  await commit;
  expect(controller.state.start).toBeNull();
  expect(controller.state.phase).toBe("Idle");
});
it("debounces validated preview and ignores stale results after switching tools", async () => {
  vi.useFakeTimers();
  try {
    const host: ToolHost = {
        preview: vi.fn(async (): Promise<SketchReply> => ({
          status: "preview",
          stats: { vertices: 2, edges: 1, faces: 0, areas: [] },
        })),
        commit: async () => ({ status: "applied" }),
      },
      controller = new ToolController(host, 100);
    controller.activate("line");
    await controller.click([0, 0, 0], plane, "one");
    controller.move([1, 0, 0], plane);
    controller.move([2, 0, 0], plane);
    await vi.advanceTimersByTimeAsync(100);
    expect(host.preview).toHaveBeenCalledTimes(1);
    expect(controller.state.preview).toBe("valid");
    controller.activate("rectangle");
    expect(controller.state.start).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});
