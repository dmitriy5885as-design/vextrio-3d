import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  canonical,
  classifyBody,
  createIdAllocator,
  defaultPolicy,
  distanceTolerance,
  id,
  localToWorld,
  projectPoint,
  unprojectPoint,
  validateGeometry,
  validatePlane,
  validateTransform,
  worldToLocal,
  type GeometryModel,
  type PlacementTransform,
} from "@forma/geometry";
import { orientation } from "../packages/geometry/src/predicates";
import {
  nonManifold,
  sheet,
  tetrahedron,
  topologyContext,
  wire,
} from "./fixtures/topology";
describe("S2 topology corpus", () => {
  it.each([
    [wire, "wire"],
    [sheet, "sheet"],
    [tetrahedron, "closed-shell"],
    [nonManifold, "non-manifold"],
  ] as const)("validates and classifies %s", (fixture, classification) => {
    const m = fixture();
    expect(() => validateGeometry(m, topologyContext)).not.toThrow();
    expect(classifyBody(m, "body/0")).toBe(classification);
    expect(canonical(JSON.parse(canonical(m)))).toBe(canonical(m));
  });
  const corruptions: [string, (m: GeometryModel) => void][] = [
    [
      "wrong table key",
      (m) => {
        m.vertices["v/0"].id = id("other");
      },
    ],
    [
      "global ID collision",
      (m) => {
        m.edges["v/0"] = { ...m.edges["e/0"], id: id("v/0") };
        delete m.edges["e/0"];
      },
    ],
    [
      "missing endpoint",
      (m) => {
        m.edges["e/0"].end = id("missing");
      },
    ],
    [
      "zero edge",
      (m) => {
        m.vertices["v/1"].position = [0, 0, 0];
      },
    ],
    [
      "nonfinite coordinate",
      (m) => {
        m.vertices["v/1"].position[0] = Infinity;
      },
    ],
    [
      "body missing edge",
      (m) => {
        m.bodies["body/0"].edgeIds = [];
      },
    ],
    [
      "body missing vertex",
      (m) => {
        m.bodies["body/0"].vertexIds.pop();
      },
    ],
    [
      "wrong owner",
      (m) => {
        m.ownerDefinitionId = id("definition/other");
      },
    ],
    [
      "open loop",
      (m) => {
        m.coedges["c/0/0"].direction = -1;
      },
    ],
    [
      "duplicate coedge",
      (m) => {
        m.loops["l/0"].coedgeIds[1] = m.loops["l/0"].coedgeIds[0];
      },
    ],
    [
      "orphan loop",
      (m) => {
        delete m.faces["f/0"];
        m.bodies["body/0"].faceIds = [];
      },
    ],
    [
      "wrong material",
      (m) => {
        m.faces["f/0"].frontMaterialId = id("material/missing");
      },
    ],
    [
      "nonplanar vertex",
      (m) => {
        m.vertices["v/2"].position[1] = 1;
      },
    ],
    [
      "left-handed plane",
      (m) => {
        m.faces["f/0"].plane.normal = [0, 1, 0];
      },
    ],
    [
      "self crossing loop",
      (m) => {
        [m.vertices["v/1"].position, m.vertices["v/2"].position] = [
          m.vertices["v/2"].position,
          m.vertices["v/1"].position,
        ];
      },
    ],
  ];
  it.each(corruptions)(
    "rejects %s without repairing the caller",
    (_, corrupt) => {
      const m = sheet();
      corrupt(m);
      const before = structuredClone(m);
      expect(() => validateGeometry(m, topologyContext)).toThrow();
      expect(m).toEqual(before);
    },
  );
  it("rejects disconnected bodies", () => {
    const m = wire();
    m.vertices["v/2"] = { id: id("v/2"), position: [5, 0, 0] };
    m.vertices["v/3"] = { id: id("v/3"), position: [7, 0, 0] };
    m.edges["e/1"] = {
      id: id("e/1"),
      start: id("v/2"),
      end: id("v/3"),
      curve: { kind: "line" },
    };
    m.bodies["body/0"].vertexIds.push(id("v/2"), id("v/3"));
    m.bodies["body/0"].edgeIds.push(id("e/1"));
    expect(() => validateGeometry(m, topologyContext)).toThrow(/Disconnected/);
  });
  it("checks external ID collisions and does not invoke accessors", () => {
    const m = wire();
    expect(() =>
      validateGeometry(m, {
        ...topologyContext,
        reservedIds: new Set(["v/0"]),
      }),
    ).toThrow();
    let invoked = false;
    Object.defineProperty(m, "trap", {
      get() {
        invoked = true;
        throw Error("getter");
      },
      enumerable: true,
    });
    expect(() => validateGeometry(m, topologyContext)).toThrow();
    expect(invoked).toBe(false);
  });
  it("allocates deterministic noncolliding IDs including retired reservations", () => {
    const a = createIdAllocator(id("op/1"), ["op/1/vertex/0"]),
      b = createIdAllocator(id("op/1"), ["op/1/vertex/0"]);
    expect(a("vertex")).toBe("op/1/vertex/1");
    expect(b("vertex")).toBe("op/1/vertex/1");
    expect(a("edge")).toBe("op/1/edge/2");
    expect(() => id("__proto__")).toThrow();
  });
});
describe("geometry metric and exact predicates", () => {
  it("roundtrips a nonuniform scaled rotated translated placement", () => {
    const t: PlacementTransform = {
        translation: [12, 5, -8],
        rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
        scale: [2, 3, 0.5],
      },
      p: [number, number, number] = [2, 4, -1];
    const world = localToWorld(p, t),
      back = worldToLocal(world, t);
    expect(world[0]).toBeCloseTo(11.5);
    expect(world[1]).toBeCloseTo(17);
    expect(world[2]).toBeCloseTo(-12);
    back.forEach((n, i) => expect(n).toBeCloseTo(p[i], 12));
  });
  it.each([
    [0, 1, 1],
    [-1, 1, 1],
    [1e-12, 1, 1],
  ])("rejects invalid scale %s", (...scale) => {
    expect(() =>
      validateTransform({
        translation: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        scale: scale as [number, number, number],
      }),
    ).toThrow();
  });
  it("projects into a translated plane and applies versioned tolerances", () => {
    const plane = {
      origin: [3, 4, 5] as [number, number, number],
      u: [1, 0, 0] as [number, number, number],
      v: [0, 0, 1] as [number, number, number],
      normal: [0, -1, 0] as [number, number, number],
    };
    validatePlane(plane);
    expect(unprojectPoint(projectPoint([6, 4, 9], plane), plane)).toEqual([
      6, 4, 9,
    ]);
    expect(distanceTolerance(1)).toBe(defaultPolicy.absoluteDistance);
    expect(distanceTolerance(1e6)).toBe(1e-6);
    expect(() => distanceTolerance(NaN)).toThrow();
  });
  it("gets exact signs for cancellation, reversed and subnormal inputs", () => {
    expect(orientation([0, 0], [1, 1], [1, 1 + Number.EPSILON])).toBe(1);
    expect(orientation([0, 0], [1, 1 + Number.EPSILON], [1, 1])).toBe(-1);
    expect(
      orientation([0, 0], [Number.MIN_VALUE, 0], [0, Number.MIN_VALUE]),
    ).toBe(1);
    expect(orientation([0, 0], [1, 1], [2, 2])).toBe(0);
  });
  it("keeps the entire production geometry package independent of rendering and UI", () => {
    const root = join(process.cwd(), "packages/geometry/src");
    for (const file of readdirSync(root).filter((f) => f.endsWith(".ts"))) {
      const source = readFileSync(join(root, file), "utf8");
      expect(source).not.toMatch(
        /from\s+['"](?:three|react|zustand|@tauri|@forma\/viewport|@forma\/editor)/,
      );
      expect(source).not.toMatch(/\b(?:window|document|Worker)\s*[.(]/);
    }
  });
});
