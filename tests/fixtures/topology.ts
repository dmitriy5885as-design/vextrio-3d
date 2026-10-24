import {
  cross,
  emptyGeometry,
  id,
  length,
  multiply,
  subtract,
  type GeometryModel,
  type PlaneFrame,
  type Vec3,
} from "@forma/geometry";
export const topologyContext = {
  ownerDefinitionId: "definition/test",
  materialIds: new Set(["material/default"]),
};
export function topology(
  points: Vec3[],
  polygons: number[][] = [],
  wireEdges: [number, number][] = [],
): GeometryModel {
  const m = emptyGeometry(id("geometry/test"), id("definition/test"));
  points.forEach((position, i) => {
    const key = id<"vertex">(`v/${i}`);
    m.vertices[key] = { id: key, position };
  });
  const edgeKeys = new Map<string, string>();
  function edge(a: number, b: number) {
    const key = [a, b].sort((x, y) => x - y).join("/");
    let eid = edgeKeys.get(key);
    if (!eid) {
      eid = `e/${edgeKeys.size}`;
      edgeKeys.set(key, eid);
      m.edges[eid] = {
        id: id(eid),
        start: id(`v/${a}`),
        end: id(`v/${b}`),
        curve: { kind: "line" },
      };
    }
    return m.edges[eid];
  }
  wireEdges.forEach(([a, b]) => edge(a, b));
  polygons.forEach((vertices, i) => {
    const loopId = id<"loop">(`l/${i}`),
      faceId = id<"face">(`f/${i}`);
    const u = multiply(
      subtract(points[vertices[1]], points[vertices[0]]),
      1 / length(subtract(points[vertices[1]], points[vertices[0]])),
    );
    const n0 = cross(u, subtract(points[vertices[2]], points[vertices[0]])),
      normal = multiply(n0, 1 / length(n0));
    const plane: PlaneFrame = {
      origin: points[vertices[0]],
      u,
      v: cross(normal, u),
      normal,
    };
    const coedgeIds = vertices.map((a, j) => {
      const e = edge(a, vertices[(j + 1) % vertices.length]),
        cid = id<"coedge">(`c/${i}/${j}`);
      m.coedges[cid] = {
        id: cid,
        edgeId: e.id,
        direction: e.start === `v/${a}` ? 1 : -1,
        loopId,
      };
      return cid;
    });
    m.loops[loopId] = { id: loopId, coedgeIds };
    m.faces[faceId] = {
      id: faceId,
      plane,
      outerLoopId: loopId,
      innerLoopIds: [],
      frontMaterialId: id("material/default"),
      backMaterialId: id("material/default"),
    };
  });
  const bodyId = id<"body">("body/0");
  m.bodies[bodyId] = {
    id: bodyId,
    vertexIds: Object.values(m.vertices).map((v) => v.id),
    edgeIds: Object.values(m.edges).map((e) => e.id),
    faceIds: Object.values(m.faces).map((f) => f.id),
    shellIds: [],
  };
  return m;
}
export const wire = () =>
  topology(
    [
      [0, 0, 0],
      [2, 0, 0],
    ],
    [],
    [[0, 1]],
  );
export const sheet = () =>
  topology(
    [
      [0, 0, 0],
      [2, 0, 0],
      [2, 0, 2],
      [0, 0, 2],
    ],
    [[0, 1, 2, 3]],
  );
export function tetrahedron() {
  const m = topology(
    [
      [0, 0, 0],
      [2, 0, 0],
      [0, 2, 0],
      [0, 0, 2],
    ],
    [
      [0, 2, 1],
      [0, 1, 3],
      [1, 2, 3],
      [2, 0, 3],
    ],
  );
  const sid = id<"shell">("shell/0");
  m.shells[sid] = {
    id: sid,
    faces: Object.values(m.faces).map((f) => ({
      faceId: f.id,
      orientation: 1,
    })),
  };
  m.bodies["body/0"].shellIds = [sid];
  return m;
}
export const nonManifold = () =>
  topology(
    [
      [0, 0, 0],
      [2, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [0, -1, 0],
    ],
    [
      [0, 1, 2],
      [1, 0, 3],
      [0, 1, 4],
    ],
  );
