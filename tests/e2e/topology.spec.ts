import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { PerspectiveCamera, Vector3 } from "three";
import { topologyProject, componentProject } from "../fixtures/v2-project";
import {
  serializeProject,
  parseProject,
  type ProjectV2,
} from "@forma/document";
async function open(p: Page, doc: ProjectV2) {
  await p.locator("input[type=file]").setInputFiles({
    name: "sketch.v3d",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(doc)),
  });
  await expect(p.getByTestId("viewport")).toBeVisible();
}
async function clickWorld(
  p: Page,
  doc: ProjectV2,
  point: [number, number, number],
) {
  const box = (await p.getByTestId("viewport").boundingBox())!,
    camera = new PerspectiveCamera(45, box.width / box.height, 0.05, 10000);
  camera.position.fromArray(doc.camera.position);
  camera.lookAt(new Vector3(...doc.camera.target));
  camera.updateMatrixWorld();
  const v = new Vector3(...point).project(camera);
  await p.mouse.click(
    box.x + ((v.x + 1) * box.width) / 2,
    box.y + ((1 - v.y) * box.height) / 2,
  );
}
test("native S3 hole renders, picks face/edge/vertex IDs, and roundtrips from the real file UI", async ({
  page,
}) => {
  const doc = topologyProject(),
    g = Object.values(doc.geometries)[0];
  await page.goto("/");
  await open(page, doc);
  await clickWorld(page, doc, [3, 1.5, 0]);
  const panel = page.getByTestId("topology-selection");
  await expect(panel).toHaveAttribute("data-kind", "face");
  await expect(panel).toHaveAttribute(
    "data-entity-id",
    Object.keys(g.faces)[0],
  );
  await expect(page.getByTestId("face-area")).toContainText("11 м²");
  await page.getByRole("button", { name: "Структура", exact: true }).click();
  await page
    .locator(".structure .tree-object > button:first-child")
    .first()
    .click();
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute(
    "data-entity-id",
    Object.keys(g.faces)[0],
  );
  await clickWorld(page, doc, [4, 1.5, 0]);
  await expect(panel).toHaveAttribute("data-kind", "edge");
  const edgeId = await panel.getAttribute("data-entity-id");
  expect(g.edges[edgeId!]).toBeDefined();
  await clickWorld(page, doc, [4, 3, 0]);
  await expect(panel).toHaveAttribute("data-kind", "vertex");
  const vertexId = await panel.getAttribute("data-entity-id");
  expect(g.vertices[vertexId!].position).toEqual([4, 3, 0]);
  await clickWorld(page, doc, [1.5, 1.5, 0]);
  await expect(panel).toHaveCount(0); // True hole: no invisible filled picking surface.
  const downloading = page.waitForEvent("download");
  await page.keyboard.press("Control+s");
  const download = await downloading,
    text = readFileSync((await download.path())!, "utf8"),
    saved = parseProject(text);
  expect(JSON.parse(text).schemaVersion).toBe(2);
  expect(JSON.parse(text).geometries).toEqual(
    JSON.parse(serializeProject(doc)).geometries,
  );
  expect(saved.schemaVersion).toBe(2);
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "reopened.v3d",
    mimeType: "application/json",
    buffer: Buffer.from(text),
  });
  await clickWorld(page, doc, [3, 1.5, 0]);
  await expect(page.getByTestId("topology-selection")).toHaveAttribute(
    "data-entity-id",
    Object.keys(g.faces)[0],
  );
  await clickWorld(page, doc, [4, 1.5, 0]);
  await expect(page.getByTestId("topology-selection")).toHaveAttribute(
    "data-entity-id",
    edgeId!,
  );
  await page.screenshot({ path: "test-results/v2-topology.png" });
});
test("a real face deletion shares Undo/Redo with primitive commands and recovers from a bad file", async ({
  page,
}) => {
  const doc = topologyProject();
  await page.goto("/");
  await open(page, doc);
  await clickWorld(page, doc, [3, 1.5, 0]);
  await page
    .getByRole("button", { name: "Удалить грань", exact: true })
    .click();
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "0",
  );
  await page.getByRole("button", { name: "Создать: Куб", exact: true }).click();
  await expect(
    page.locator(".tree-object").filter({ hasText: "Куб 1" }),
  ).toHaveCount(1);
  await page.keyboard.press("Control+z");
  await expect(
    page.locator(".tree-object").filter({ hasText: "Куб 1" }),
  ).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "1",
  );
  // M now edits canonical geometry; return to selection after undoing the primitive.
  await page.keyboard.press("Space");
  await clickWorld(page, doc, [3, 1.5, 0]);
  await expect(page.getByTestId("face-area")).toContainText("11 м²");
  page.on("dialog", (dialog) =>
    dialog.type() === "confirm" ? dialog.accept() : dialog.dismiss(),
  );
  const bad = JSON.parse(serializeProject(doc));
  Object.values(
    bad.geometries as Record<
      string,
      { vertices: Record<string, { position: number[] }> }
    >,
  )[0].vertices[
    Object.keys(
      Object.values(
        bad.geometries as Record<
          string,
          { vertices: Record<string, { position: number[] }> }
        >,
      )[0].vertices,
    )[0]
  ].position = [0, 0, Infinity];
  await page.locator("input[type=file]").setInputFiles({
    name: "broken.v3d",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(bad)),
  });
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "1",
  );
  await clickWorld(page, doc, [4, 1.5, 0]);
  await expect(page.getByTestId("topology-selection")).toHaveAttribute(
    "data-kind",
    "edge",
  );
});
test("two occurrences of a shared component pick the same entity with distinct paths", async ({
  page,
}) => {
  const doc = componentProject();
  doc.camera = {
    position: [2, 8, 18],
    target: [2, 1.5, 0],
    projection: "perspective",
    zoom: 1,
  };
  await page.goto("/");
  await open(page, doc);
  await clickWorld(page, doc, [-2, 1.5, 0]);
  const panel = page.getByTestId("topology-selection");
  await expect(panel).toHaveAttribute("data-kind", "face");
  await expect(panel).toContainText("instance/group / instance/one");
  const fid = await panel.getAttribute("data-entity-id");
  await clickWorld(page, doc, [8, 1.5, 0]);
  await expect(panel).toHaveAttribute("data-entity-id", fid!);
  await expect(panel).toContainText("instance/two");
});
test("native parent visibility and shared-definition locks participate in real editor history", async ({
  page,
}) => {
  const doc = componentProject();
  doc.camera = {
    position: [2, 8, 18],
    target: [2, 1.5, 0],
    projection: "perspective",
    zoom: 1,
  };
  await page.goto("/");
  await open(page, doc);
  await page.getByTitle("Скрыть узел Группа слева", { exact: true }).click();
  await clickWorld(page, doc, [-2, 1.5, 0]);
  await expect(page.getByTestId("topology-selection")).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await clickWorld(page, doc, [-2, 1.5, 0]);
  await expect(page.getByTestId("topology-selection")).toHaveAttribute(
    "data-kind",
    "face",
  );
  // The left dock now combines the structure tree and the properties panel as
  // tabs, so the tree must be opened before using its node controls.
  await page.getByRole("button", { name: "Структура", exact: true }).click();
  await page
    .getByTitle("Заблокировать узел Компонент 2", { exact: true })
    .click();
  await clickWorld(page, doc, [-2, 1.5, 0]);
  await expect(
    page.getByRole("button", { name: "Удалить грань", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Control+z");
  await clickWorld(page, doc, [-2, 1.5, 0]);
  await page
    .getByRole("button", {
      name: "Войти в группу для редактирования",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", {
      name: "Войти в группу для редактирования",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Удалить грань", exact: true }),
  ).toBeEnabled();
});
