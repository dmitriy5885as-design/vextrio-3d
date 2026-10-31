import { it, expect } from "vitest";
import { rayOnAxis, normalize } from "@forma/snapping";
import { subtract, type Vec3 } from "@forma/geometry";
it.each([
  [5, 0, 3],
  [4, 2, 3],
  [4, 0, 6],
] as Vec3[])(
  "cursor ray retains exact point on a locked world axis: %s",
  (x, y, z) => {
    const origin: Vec3 = [9, 7, 10],
      point: Vec3 = [x, y, z],
      anchor: Vec3 = [4, 0, 3],
      delta = subtract(point, anchor),
      d = normalize(delta),
      hit = rayOnAxis(origin, normalize(subtract(point, origin)), anchor, d)!;
    for (let i = 0; i < 3; i++) expect(hit[i]).toBeCloseTo(point[i], 10);
  },
);
it("parallel, nearly parallel and behind-camera axis queries fail closed", () => {
  expect(rayOnAxis([0, 1, 0], [1, 0, 0], [0, 0, 0], [1, 0, 0])).toBeNull();
  expect(rayOnAxis([0, 1, 0], [1, 1e-8, 0], [0, 0, 0], [1, 0, 0])).toBeNull();
  expect(rayOnAxis([0, 1, 0], [0, 1, 0], [0, 0, 0], [1, 0, 0])).toBeNull();
});
