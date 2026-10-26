import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { brand } from "@forma/ui";
import { parseProject, serializeProject } from "@forma/document";
const read = (path: string) =>
  readFileSync(path, "utf8").replace(/\r\n/g, "\n");
it("presents the new brand consistently in browser and native metadata", () => {
  const config = JSON.parse(read("apps/desktop/src-tauri/tauri.conf.json"));
  expect(brand.name).toBe("VEXTRIO 3D");
  expect(config.productName).toBe(brand.name);
  expect(config.app.windows[0].title).toBe(brand.name);
  expect(config.identifier).toBe("studio.forma.editor");
  expect(config.mainBinaryName).toBe("forma-editor");
  expect(config.bundle.publisher).toBe(brand.name);
  expect(config.bundle.targets).toEqual(["nsis"]);
  expect(read("index.html")).toContain("<title>VEXTRIO 3D —");
  expect(read("index.html")).toContain("/vextrio.svg");
  for (const path of [
    "apps/web/src/App.tsx",
    "packages/ui/src/index.ts",
    "index.html",
    "apps/desktop/src-tauri/src/main.rs",
  ])
    expect(read(path)).not.toMatch(/\bFORMA\b/);
  expect(read("public/forma.svg")).toBe(read("public/vextrio.svg"));
});
it("preserves legacy file discriminator, schema, user names, IDs and materials", () => {
  const legacy = JSON.parse(read("tests/fixtures/v1/m.v3d"));
  legacy.format = "forma";
  legacy.name = "Мой проект FORMA";
  legacy.extension.vendor = "FORMA";
  const accepted = parseProject(JSON.stringify(legacy));
  expect(accepted).toEqual(legacy);
  expect(JSON.parse(serializeProject(accepted))).toEqual(legacy);
  expect(JSON.parse(serializeProject(accepted)).format).toBe("forma");
  expect(accepted.schemaVersion).toBe(1);
});
it("keeps unknown schema rejection instead of disguising v2 as a rebrand migration", () => {
  const legacy = JSON.parse(read("tests/fixtures/v1/m.v3d"));
  legacy.schemaVersion = 999;
  expect(() => parseProject(JSON.stringify(legacy))).toThrow(/VEXTRIO 3D/);
});
it("pins NSIS upstream and limits template changes to legacy registry identity", () => {
  const manifest = JSON.parse(
    read("apps/desktop/src-tauri/installer/upstream.json"),
  );
  let template = read("apps/desktop/src-tauri/installer/compat.nsi");
  expect(manifest.version).toBe(
    JSON.parse(read("node_modules/@tauri-apps/cli/package.json")).version,
  );
  expect(manifest.changes).toHaveLength(2);
  for (const [before, after] of manifest.changes) {
    expect(template.split(after)).toHaveLength(2);
    template = template.replace(after, before);
  }
  expect(createHash("sha256").update(template).digest("hex")).toBe(
    manifest.sha256LF,
  );
  const config = JSON.parse(read("apps/desktop/src-tauri/tauri.conf.json"));
  expect(config.bundle.windows.nsis.template).toBe("installer/compat.nsi");
  expect(config.bundle.windows.nsis.installerHooks).toBe(
    "installer/rename-shortcuts.nsh",
  );
  expect(template).toContain('ReadRegStr $4 SHCTX "${MANUPRODUCTKEY}" ""');
  expect(
    read("apps/desktop/src-tauri/installer/rename-shortcuts.nsh"),
  ).toContain("IsShortcutTarget");
});
it("generates the complete native icon set from the new V source", () => {
  const png = readFileSync("apps/desktop/src-tauri/icons/32x32.png");
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(png.readUInt32BE(16)).toBe(32);
  expect(png.readUInt32BE(20)).toBe(32);
  const ico = readFileSync("apps/desktop/src-tauri/icons/icon.ico");
  expect(ico.readUInt16LE(0)).toBe(0);
  expect(ico.readUInt16LE(2)).toBe(1);
  expect(ico.readUInt16LE(4)).toBeGreaterThan(1);
  expect(read("public/vextrio.svg")).toContain('viewBox="0 0 128 128"');
});
