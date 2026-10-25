import { expect, it } from "vitest";
import {
  applyDelta,
  canonical,
  createLocalGeometryBackend,
  diffGeometry,
  GeometrySession,
  id,
  invertDelta,
  validatePrepared,
  type GeometryBackend,
  type GeometryRequest,
  type GeometryResponse,
  type PreparedGeometryChange,
  type Vec3,
} from "@forma/geometry";
import { sheet, topologyContext, wire } from "./fixtures/topology";
const move = (position: Vec3) => ({
  kind: "move-vertices" as const,
  positions: [{ vertexId: id<"vertex">("v/1"), position }],
});
function session(
  backend: GeometryBackend = createLocalGeometryBackend(topologyContext),
) {
  return new GeometrySession(wire(), topologyContext, backend, id("session/0"));
}
function deferredBackend() {
  const jobs: {
    request: GeometryRequest;
    resolve: (r: GeometryResponse) => void;
    reject: (e: Error) => void;
  }[] = [];
  const backend: GeometryBackend = {
    propose: (request) =>
      new Promise((resolve, reject) => jobs.push({ request, resolve, reject })),
  };
  async function finish(index: number) {
    const job = jobs[index];
    job.resolve(
      await createLocalGeometryBackend(topologyContext).propose(job.request),
    );
  }
  return { jobs, backend, finish };
}
function checkpoint(s: GeometrySession) {
  return {
    model: structuredClone(s.snapshot),
    revision: s.revision,
    undo: s.canUndo,
    redo: s.canRedo,
  };
}
it("applies a delta and its inverse with exactly the same entities and IDs", () => {
  const before = sheet(),
    after = structuredClone(before);
  after.vertices["v/1"].position = [3, 0, 0];
  const delta = diffGeometry(before, after),
    inverse = invertDelta(delta);
  expect(applyDelta(before, delta, topologyContext)).toEqual(after);
  expect(applyDelta(after, inverse, topologyContext)).toEqual(before);
  expect(before.vertices["v/1"].position).toEqual([2, 0, 0]);
  expect(() => applyDelta(after, delta, topologyContext)).toThrow(
    /precondition/,
  );
});
it("rejects broken inverse and invalid geometry before publishing anything", () => {
  const before = wire(),
    after = structuredClone(before);
  after.vertices["v/1"].position = [3, 0, 0];
  const forward = diffGeometry(before, after),
    change: PreparedGeometryChange = {
      forward,
      inverse: invertDelta(forward),
      lineage: [],
    };
  change.inverse.vertices[0].after!.position = [4, 0, 0];
  expect(() =>
    validatePrepared(before, change, topologyContext, id("operation/0")),
  ).toThrow(/Inverse/);
  after.vertices["v/1"].position = [0, 0, 0];
  expect(() =>
    applyDelta(before, diffGeometry(before, after), topologyContext),
  ).toThrow(/short edge/);
  expect(before).toEqual(wire());
});
it("supports stable-ID Undo/Redo and isolates backend/caller aliases", async () => {
  const s = session(),
    before = checkpoint(s);
  const intent = move([3, 0, 0]);
  expect(await s.execute(intent)).toEqual({ status: "applied" });
  intent.positions[0].position[0] = 999;
  const accepted = structuredClone(s.snapshot);
  expect(s.snapshot.vertices["v/1"].position[0]).toBe(3);
  expect(() => {
    s.snapshot.vertices["v/1"].position[0] = 5;
  }).toThrow();
  expect(s.undo()).toEqual({ status: "applied" });
  expect(s.snapshot).toEqual(before.model);
  expect(s.redo()).toEqual({ status: "applied" });
  expect(s.snapshot).toEqual(accepted);
  expect(s.revision).toBe(3);
});
it("leaves model, revision and redo intact after errors, no-op and unsupported operations", async () => {
  const s = session();
  await s.execute(move([3, 0, 0]));
  s.undo();
  const before = checkpoint(s);
  expect((await s.execute(move([0, 0, 0]))).status).toBe("error");
  expect(await s.execute(move([2, 0, 0]))).toEqual({ status: "noop" });
  const unsupported = await s.execute({
    kind: "delete-entities",
    entityIds: ["missing"],
  });
  expect(unsupported.status).toBe("error");
  if (unsupported.status === "error")
    expect(unsupported.diagnostics[0].code).toBe("UNSUPPORTED_OPERATION");
  expect(checkpoint(s)).toEqual(before);
  expect(s.redo().status).toBe("applied");
});
it("keeps preview completely outside history and the authoritative model", async () => {
  const s = session(),
    before = checkpoint(s);
  const result = await s.execute(move([3, 0, 0]), "preview");
  expect(result.status).toBe("preview");
  if (result.status === "preview")
    expect(result.model.vertices["v/1"].position[0]).toBe(3);
  expect(checkpoint(s)).toEqual(before);
});
it("rejects an explicitly locked edit before invoking backend", async () => {
  let called = false;
  const s = session({
    async propose() {
      called = true;
      throw Error("unexpected");
    },
  });
  expect((await s.execute(move([3, 0, 0]), "commit", true)).status).toBe(
    "error",
  );
  expect(called).toBe(false);
  expect(s.revision).toBe(0);
});
it("accepts only the first concurrent result at a revision", async () => {
  const d = deferredBackend(),
    s = session(d.backend),
    a = s.execute(move([3, 0, 0])),
    b = s.execute(move([4, 0, 0]));
  await d.finish(1);
  expect(await b).toEqual({ status: "applied" });
  await d.finish(0);
  expect(await a).toEqual({ status: "stale" });
  expect(s.snapshot.vertices["v/1"].position[0]).toBe(4);
  expect(s.revision).toBe(1);
});
it("does not apply a result after Undo", async () => {
  const d = deferredBackend(),
    s = session(d.backend);
  const first = s.execute(move([3, 0, 0]));
  await d.finish(0);
  await first;
  const pending = s.execute(move([4, 0, 0]));
  s.undo();
  await d.finish(1);
  expect(await pending).toEqual({ status: "stale" });
  expect(s.snapshot).toEqual(wire());
  expect(s.canRedo).toBe(true);
});
it("cancels old-session work and rejects session-ID reuse", async () => {
  const d = deferredBackend(),
    s = session(d.backend),
    pending = s.execute(move([3, 0, 0]));
  s.replace(wire(), id("session/1"));
  await d.finish(0);
  expect(await pending).toEqual({ status: "cancelled" });
  expect(s.revision).toBe(0);
  expect(() => s.replace(wire(), id("session/0"))).toThrow(/reused/);
});
it("ignores cancellation even when the backend resolves successfully", async () => {
  const d = deferredBackend(),
    s = session(d.backend),
    before = checkpoint(s),
    pending = s.execute(move([3, 0, 0]));
  s.cancelAll();
  await d.finish(0);
  expect(await pending).toEqual({ status: "cancelled" });
  expect(checkpoint(s)).toEqual(before);
});
it("isolates backend input mutations and transport failures", async () => {
  const s = session({
      async propose(request) {
        request.model.vertices["v/1"].position = [99, 0, 0];
        throw Error("worker crashed");
      },
    }),
    before = checkpoint(s);
  expect((await s.execute(move([3, 0, 0]))).status).toBe("error");
  expect(checkpoint(s)).toEqual(before);
});
it.each([
  "sessionId",
  "requestId",
  "operationId",
  "baseRevision",
  "protocolVersion",
  "geometryPolicyVersion",
] as const)("rejects mismatched response %s", async (key) => {
  const backend = createLocalGeometryBackend(topologyContext);
  const s = session({
      async propose(request) {
        const result = await backend.propose(request);
        Object.assign(result, {
          [key]: typeof result[key] === "number" ? 99 : "unrelated",
        });
        return result;
      },
    }),
    before = checkpoint(s);
  expect((await s.execute(move([3, 0, 0]))).status).toBe("error");
  expect(checkpoint(s)).toEqual(before);
});
it("carries a split lineage and restores retired IDs with the inverse", () => {
  const before = wire(),
    after = structuredClone(before),
    operationId = id<"operation">("operation/split");
  after.vertices["v/2"] = { id: id("v/2"), position: [1, 0, 0] };
  delete after.edges["e/0"];
  after.edges["e/1"] = {
    id: id("e/1"),
    start: id("v/0"),
    end: id("v/2"),
    curve: { kind: "line" },
  };
  after.edges["e/2"] = {
    id: id("e/2"),
    start: id("v/2"),
    end: id("v/1"),
    curve: { kind: "line" },
  };
  after.bodies["body/0"].vertexIds.push(id("v/2"));
  after.bodies["body/0"].edgeIds = [id("e/1"), id("e/2")];
  const forward = diffGeometry(before, after),
    change: PreparedGeometryChange = {
      forward,
      inverse: invertDelta(forward),
      lineage: [
        {
          operationId,
          kind: "edge",
          retiredId: "e/0",
          reason: "split",
          descendants: [
            { id: "e/1", parameterRange: [0, 0.5] },
            { id: "e/2", parameterRange: [0.5, 1] },
          ],
        },
      ],
    };
  expect(
    validatePrepared(before, change, topologyContext, operationId),
  ).toEqual(after);
  expect(applyDelta(after, change.inverse, topologyContext)).toEqual(before);
  change.lineage = [];
  expect(() =>
    validatePrepared(before, change, topologyContext, operationId),
  ).toThrow(/lineage/);
});
it("has canonical content equality independent of table insertion order", () => {
  const m = wire(),
    n = structuredClone(m);
  n.vertices = Object.fromEntries(Object.entries(n.vertices).reverse());
  expect(canonical(m)).toBe(canonical(n));
});
