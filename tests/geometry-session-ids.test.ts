import { expect, it } from "vitest";
import {
  createLocalGeometryBackend,
  GeometrySession,
  id,
} from "@forma/geometry";
import { topologyContext, wire } from "./fixtures/topology";
it("accepts the longest valid session ID without overflowing generated entity IDs", async () => {
  const s = new GeometrySession(
    wire(),
    topologyContext,
    createLocalGeometryBackend(topologyContext),
    id("s".repeat(200)),
  );
  expect(
    await s.execute({
      kind: "move-vertices",
      positions: [{ vertexId: id("v/1"), position: [3, 0, 0] }],
    }),
  ).toEqual({ status: "applied" });
});
