import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { canonical } from "@forma/geometry";
import { createSketchExamples } from "./fixtures/sketch-examples";
it("reproduces the published numeric inputs, complete topology and stable-ID lineage", () => {
  const expected = JSON.parse(
      readFileSync("docs/0.2/S3_EXAMPLES.json", "utf8"),
    ),
    actual = createSketchExamples();
  expect(canonical(actual)).toBe(canonical(expected));
  expect(actual.cases.map((c) => c.areas)).toEqual([[12], [6, 6], [], [1, 11]]);
  expect(actual.cases[2].counts).toMatchObject({
    vertices: 5,
    edges: 4,
    faces: 0,
  });
});
