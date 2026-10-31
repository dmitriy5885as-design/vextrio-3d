import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { APP_VERSION, APP_RELEASE_LABEL } from "@forma/shared";
import { useEditor } from "@forma/editor";
import {
  topologyProject,
  firstRef,
  componentProject,
} from "./fixtures/v2-project";
import { validateProject, type ProjectV2 } from "@forma/document";
it("ships a consistent alpha version without changing compatibility identifiers", () => {
  const root = JSON.parse(readFileSync("package.json", "utf8")),
    tauri = JSON.parse(
      readFileSync("apps/desktop/src-tauri/tauri.conf.json", "utf8"),
    ),
    cargo = readFileSync("apps/desktop/src-tauri/Cargo.toml", "utf8");
  expect(APP_VERSION).toBe("0.2.0-alpha.11");
  expect(root.version).toBe(APP_VERSION);
  expect(tauri.version).toBe(APP_VERSION);
  expect(tauri.app.windows[0].title).toBe(`VEXTRIO 3D — ${APP_RELEASE_LABEL}`);
  expect(cargo).toContain(`version = "${APP_VERSION}"`);
  expect(tauri.identifier).toBe("studio.forma.editor");
});
it("paints both face sides atomically, preserves other faces and parameters, then restores exact IDs through Undo/Redo", () => {
  const p = topologyProject(),
    ref = firstRef(p, "face");
  useEditor.getState().replace(p);
  expect(useEditor.getState().setFaceColor(ref, "#e1a55e").status).toBe(
    "applied",
  );
  const after = useEditor.getState().project as ProjectV2;
  validateProject(after);
  const f = after.geometries[ref.geometryId].faces[ref.entityId];
  expect(after.materials[f.frontMaterialId].color).toBe("#e1a55e");
  expect(after.materials[f.backMaterialId].color).toBe("#e1a55e");
  expect(after.materials[f.frontMaterialId].roughness).toBe(
    p.materials[
      p.geometries[ref.geometryId].faces[ref.entityId].frontMaterialId
    ].roughness,
  );
  expect(after.materials).toMatchObject(p.materials);
  useEditor.getState().undo();
  expect(useEditor.getState().project).toEqual(p);
  useEditor.getState().redo();
  expect(useEditor.getState().project).toEqual(after);
});
it("rejects painting a shared locked context or invalid colour without dirty/history changes", () => {
  const p = componentProject();
  p.nodes["instance/one"].locked = true;
  const n = p.nodes["instance/two"];
  if (n.kind === "legacy-primitive") throw Error("fixture");
  const ref = firstRef(p, "face");
  ref.definitionId = n.definitionId;
  ref.occurrencePath = [n.id];
  useEditor.getState().replace(p);
  const before = useEditor.getState();
  expect(before.setFaceColor(ref, "#ff0000").status).toBe("rejected");
  expect(useEditor.getState().project).toBe(before.project);
  expect(useEditor.getState().revision).toBe(before.revision);
  expect(useEditor.getState().canUndo).toBe(false);
});
