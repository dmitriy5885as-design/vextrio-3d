import { beforeEach, it, expect } from "vitest";
import * as THREE from "three";
import { useEditor, useMove, usePrecision } from "@forma/editor";
import {
  emptyProjectV2,
  definitionAtPath,
  occurrenceMatrix,
  serializeProject,
  parseProject,
  type ProjectV2,
} from "@forma/document";
import {
  tessellateFace,
  bodyVolume,
  transformAffine,
  type GeometryModel,
  type Vec3,
} from "@forma/geometry";
import { TopologyBridge } from "../packages/viewport/src/TopologyBridge";
import { topologyProject, componentProject } from "./fixtures/v2-project";
const state = () => {
  const p = useEditor.getState().project as ProjectV2,
    g = Object.values(p.geometries)[0];
  return { p, g };
};
function projectedArea(g: GeometryModel) {
  let area = 0;
  for (const f of Object.values(g.faces)) {
    const dto = tessellateFace(g, f);
    for (let i = 0; i < dto.indices.length; i += 3) {
      const [a, b, c] = dto.indices
        .slice(i, i + 3)
        .map((v) => dto.positions[v]);
      area +=
        Math.abs(
          (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
        ) / 2;
    }
  }
  return area;
}
async function lift(point: Vec3) {
  const { g } = state(),
    v = Object.values(g.vertices).find((v) =>
      v.position.every((n, i) => Math.abs(n - point[i]) < 1e-7),
    )!;
  return useEditor.getState().editGeometry(
    {
      definitionId: g.ownerDefinitionId,
      geometryId: g.id,
      kind: "vertex",
      entityId: v.id,
      occurrencePath: [],
    },
    {
      kind: "translate-entities",
      entities: [{ kind: "vertex", id: v.id }],
      delta: [0, 0, 1],
      copy: false,
    },
  );
}
function checkHole(p: ProjectV2, x: number, y: number) {
  const bridge = new TopologyBridge(p, 1);
  try {
    expect(
      bridge.pickFace(
        new THREE.Raycaster(
          new THREE.Vector3(x, y, 10),
          new THREE.Vector3(0, 0, -1),
        ),
      ),
    ).toBeNull();
  } finally {
    bridge.dispose();
  }
}
beforeEach(() => {
  useEditor.getState().setTool("select");
  useMove.getState().cancel();
  useEditor.getState().replace(topologyProject());
  usePrecision
    .getState()
    .configure({ enabled: false, path: [], planeName: "XY", system: "world" });
});
it("folds an outer corner while preserving a true pickable hole, all boundaries, materials, provenance and history", async () => {
  const { p, g } = state(),
    source = Object.values(g.faces)[0];
  expect((await lift([4, 3, 0])).status).toBe("applied");
  const after = state(),
    m = after.g;
  expect(Object.keys(m.vertices)).toHaveLength(8);
  expect(Object.keys(m.faces).length).toBeGreaterThan(1);
  expect(projectedArea(m)).toBeCloseTo(11, 8);
  for (const [id, e] of Object.entries(g.edges)) expect(m.edges[id]).toEqual(e);
  for (const f of Object.values(m.faces)) {
    expect(f.frontMaterialId).toBe(source.frontMaterialId);
    expect(f.backMaterialId).toBe(source.backMaterialId);
  }
  checkHole(after.p, 1.5, 1.5);
  const reopened = (parseProject(serializeProject(after.p)) as ProjectV2)
    .geometries;
  expect(reopened).toEqual(after.p.geometries);
  expect(
    after.p.provenance.some(
      (l) => l.kind === "loop" && l.retiredId === source.innerLoopIds[0],
    ),
  ).toBe(true);
  useEditor.getState().undo();
  expect(useEditor.getState().project).toEqual(p);
  useEditor.getState().redo();
  expect(useEditor.getState().project).toEqual(after.p);
});
it("folds the boundary of the hole itself without filling its projected opening", async () => {
  const { g } = state();
  expect((await lift([2, 2, 0])).status).toBe("applied");
  const after = state();
  expect(Object.keys(after.g.vertices)).toHaveLength(8);
  expect(projectedArea(after.g)).toBeCloseTo(11, 8);
  for (const [id, e] of Object.entries(g.edges))
    expect(after.g.edges[id]).toEqual(e);
  checkHole(after.p, 1.5, 1.5);
});
it("keeps a distant unchanged opening as a real inner loop of one planar patch", async () => {
  const p = topologyProject();
  for (const v of Object.values(p.geometries["native/geometry"].vertices))
    if (
      v.position[0] >= 1 &&
      v.position[0] <= 2 &&
      v.position[1] >= 1 &&
      v.position[1] <= 2
    )
      v.position = [v.position[0] / 2, v.position[1] / 2, 0];
  useEditor.getState().replace(p);
  expect((await lift([4, 3, 0])).status).toBe("applied");
  const after = state();
  expect(
    Object.values(after.g.faces).filter((f) => f.innerLoopIds.length === 1),
  ).toHaveLength(1);
  expect(Object.keys(after.g.faces)).toHaveLength(2);
  expect(projectedArea(after.g)).toBeCloseTo(11.75, 8);
  checkHole(after.p, 0.75, 0.75);
});
it("moves an entire face with a hole rigidly without introducing new topology", async () => {
  const { p, g } = state(),
    f = Object.values(g.faces)[0];
  expect(
    (
      await useEditor.getState().editGeometry(
        {
          definitionId: g.ownerDefinitionId,
          geometryId: g.id,
          kind: "face",
          entityId: f.id,
          occurrencePath: [],
        },
        {
          kind: "translate-entities",
          entities: [{ kind: "face", id: f.id }],
          delta: [0, 0, 1],
          copy: false,
        },
      )
    ).status,
  ).toBe("applied");
  const after = state();
  expect(Object.keys(after.g.faces)).toEqual(Object.keys(g.faces));
  expect(after.g.edges).toEqual(g.edges);
  checkHole(after.p, 1.5, 1.5);
  expect(after.p.provenance).toEqual(p.provenance);
});
it("preserves a closed annular solid when a cap corner is folded", async () => {
  const { g } = state(),
    f = Object.values(g.faces)[0],
    ref = {
      definitionId: g.ownerDefinitionId,
      geometryId: g.id,
      kind: "face" as const,
      entityId: f.id,
      occurrencePath: [],
    };
  expect(
    (
      await useEditor.getState().editGeometry(ref, {
        kind: "extrude-face",
        faceId: f.id,
        distance: 2,
        side: 1,
      })
    ).status,
  ).toBe("applied");
  expect((await lift([4, 3, 2])).status).toBe("applied");
  const after = state();
  expect(bodyVolume(after.g, Object.keys(after.g.bodies)[0])).toBeGreaterThan(
    22,
  );
  checkHole(after.p, 1.5, 1.5);
});

async function sheet(outer: Vec3[], holes: Vec3[][], path: string[] = []) {
  const segments = [outer, ...holes].flatMap((r) =>
    r.map((a, i) => [a, r[(i + 1) % r.length]] as [Vec3, Vec3]),
  );
  expect((await useEditor.getState().drawSegments(path, segments)).status).toBe(
    "applied",
  );
  let p = useEditor.getState().project as ProjectV2;
  const did = definitionAtPath(p, path),
    gid = p.definitions[did].geometryId!,
    g = p.geometries[gid],
    outside = Object.values(g.faces).find(
      (f) => f.innerLoopIds.length === holes.length,
    )!;
  expect(outside).toBeDefined();
  const ref = {
    definitionId: g.ownerDefinitionId,
    geometryId: g.id,
    kind: "face" as const,
    entityId: outside.id,
    occurrencePath: path,
  };
  expect(
    (
      await useEditor.getState().editGeometry(ref, {
        kind: "delete-entities",
        entityIds: Object.values(g.faces)
          .filter((f) => f.id !== outside.id)
          .map((f) => f.id),
      })
    ).status,
  ).toBe("applied");
  p = useEditor.getState().project as ProjectV2;
  return { p, g: p.geometries[gid], ref };
}
const outer: Vec3[] = [
    [0, 0, 0],
    [6, 0, 0],
    [6, 5, 0],
    [0, 5, 0],
  ],
  hole1: Vec3[] = [
    [1, 1, 0],
    [2, 1, 0],
    [2, 2, 0],
    [1, 2, 0],
  ],
  hole2: Vec3[] = [
    [3, 2, 0],
    [4, 2, 0],
    [4, 3, 0],
    [3, 3, 0],
  ];
it("keeps two independent holes empty and every original boundary edge", async () => {
  useEditor.getState().replace(emptyProjectV2());
  const before = await sheet(outer, [hole1, hole2]);
  expect((await lift([6, 5, 0])).status).toBe("applied");
  const after = state();
  expect(projectedArea(after.g)).toBeCloseTo(28, 8);
  expect(Object.keys(after.g.vertices)).toHaveLength(12);
  for (const [id, e] of Object.entries(before.g.edges))
    expect(after.g.edges[id]).toEqual(e);
  checkHole(after.p, 1.5, 1.5);
  checkHole(after.p, 3.5, 2.5);
  expect(
    (parseProject(serializeProject(after.p)) as ProjectV2).geometries,
  ).toEqual(after.p.geometries);
});
it("restores collinear vertices filtered on outer and inner source boundaries", async () => {
  useEditor.getState().replace(emptyProjectV2());
  const before = await sheet(
    [
      [0, 0, 0],
      [4, 0, 0],
      [4, 1.5, 0],
      [4, 3, 0],
      [0, 3, 0],
    ],
    [
      [
        [1, 1, 0],
        [1.5, 1, 0],
        [2, 1, 0],
        [2, 2, 0],
        [1, 2, 0],
      ],
    ],
  );
  expect(Object.keys(before.g.vertices)).toHaveLength(10);
  expect((await lift([4, 3, 0])).status).toBe("applied");
  const after = state();
  expect(Object.keys(after.g.vertices)).toHaveLength(10);
  expect(projectedArea(after.g)).toBeCloseTo(11, 8);
  for (const [id, e] of Object.entries(before.g.edges))
    expect(after.g.edges[id]).toEqual(e);
  checkHole(after.p, 1.5, 1.5);
});
it("folds holes in world coordinates inside a rotated nonuniform group", async () => {
  const doc = componentProject(),
    node = doc.nodes["instance/group"];
  if (node.kind === "legacy-primitive") throw Error("fixture");
  node.transform.scale = [2, 3, 4];
  node.transform.rotation = [0, 0, Math.sin(0.2), Math.cos(0.2)];
  useEditor.getState().replace(doc);
  const before = await sheet(outer, [hole1], [node.id]),
    matrix = occurrenceMatrix(before.p, [node.id]),
    v = Object.values(before.g.vertices).find((v) => {
      const p = transformAffine(v.position, matrix);
      return Math.abs(p[0] - 6) < 1e-7 && Math.abs(p[1] - 5) < 1e-7;
    })!;
  expect(
    (
      await useEditor.getState().editGeometry(
        { ...before.ref, kind: "vertex", entityId: v.id },
        {
          kind: "translate-entities",
          entities: [{ kind: "vertex", id: v.id }],
          delta: [0, 0, 1],
          copy: false,
        },
      )
    ).status,
  ).toBe("applied");
  const p = useEditor.getState().project as ProjectV2;
  expect(p.nodes).toEqual(before.p.nodes);
  expect(p.geometries["native/geometry"]).toEqual(
    before.p.geometries["native/geometry"],
  );
  const point = transformAffine(
    p.geometries[before.g.id].vertices[v.id].position,
    matrix,
  );
  expect(point[2]).toBeCloseTo(1, 8);
});
it("rejects more than sixteen holes atomically without losing the valid source", async () => {
  useEditor.getState().replace(emptyProjectV2());
  const holes = Array.from({ length: 17 }, (_, i) => {
    const x = 1 + i * 3;
    return [
      [x, 1, 0],
      [x + 1, 1, 0],
      [x + 1, 2, 0],
      [x, 2, 0],
    ] as Vec3[];
  });
  const before = await sheet(
      [
        [0, 0, 0],
        [60, 0, 0],
        [60, 10, 0],
        [0, 10, 0],
      ],
      holes,
    ),
    revision = useEditor.getState().revision;
  expect((await lift([60, 10, 0])).status).toBe("rejected");
  expect(useEditor.getState().project).toBe(before.p);
  expect(useEditor.getState().revision).toBe(revision);
});
