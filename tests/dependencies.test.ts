import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { checkDependencies } from "../scripts/check-deps.mjs";
const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "forma-deps-"));
  roots.push(root);
  writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        moduleResolution: "Bundler",
        module: "ESNext",
        baseUrl: ".",
        paths: { "@forma/*": ["packages/*/src/index.ts"] },
      },
    }),
  );
  return root;
}
function workspace(
  root: string,
  name: string,
  files: Record<string, string>,
  deps: Record<string, string> = {},
) {
  const base = path.join(root, "packages", name);
  mkdirSync(base, { recursive: true });
  writeFileSync(
    path.join(base, "package.json"),
    JSON.stringify({ name: `@forma/${name}`, dependencies: deps }),
  );
  for (const [file, text] of Object.entries(files)) {
    const target = path.join(base, "src", file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    const resolved = path.resolve(root);
    if (
      path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
      !path.basename(resolved).startsWith("forma-deps-")
    )
      throw Error("Unexpected fixture cleanup path");
    rmSync(resolved, { recursive: true, force: true });
  }
});
it("checks nested modules, dynamic imports, reexports and type imports", () => {
  const root = fixture();
  workspace(
    root,
    "a",
    {
      "index.ts": "export * from './nested/bridge';",
      "nested/bridge.ts":
        "import type {B} from '@forma/b'; export const load=()=>import('@forma/b');",
    },
    { "@forma/b": "workspace:*" },
  );
  workspace(root, "b", { "index.ts": "export interface B {}" });
  expect(checkDependencies(root).workspaceCount).toBe(2);
});
it("detects cycles hidden behind nested files and reexports", () => {
  const root = fixture();
  workspace(
    root,
    "a",
    {
      "index.ts": "export * from './nested/bridge';",
      "nested/bridge.ts": "export * from '@forma/b';",
    },
    { "@forma/b": "workspace:*" },
  );
  workspace(
    root,
    "b",
    { "index.ts": "export const load=()=>import('@forma/a');" },
    { "@forma/a": "workspace:*" },
  );
  expect(() => checkDependencies(root)).toThrow(/cycle/);
});
it("requires external dependencies in the consuming manifest", () => {
  const root = fixture();
  workspace(root, "a", { "index.ts": "import * as React from 'react';" });
  expect(() => checkDependencies(root)).toThrow(/undeclared dependency react/);
});
it("resolves cross-workspace relative imports and requires declarations", () => {
  const root = fixture();
  workspace(root, "a", { "index.ts": "export * from '../../b/src/index';" });
  workspace(root, "b", { "index.ts": "export const b=1;" });
  expect(() => checkDependencies(root)).toThrow(
    /undeclared dependency @forma\/b/,
  );
});
it("rejects nonliteral imports rather than silently missing a dependency", () => {
  const root = fixture();
  workspace(root, "a", {
    "index.ts": 'const target="react"; export const load=()=>import(target);',
  });
  expect(() => checkDependencies(root)).toThrow(/Nonliteral/);
});
it("detects manifest cycles even before a package is imported", () => {
  const root = fixture();
  workspace(
    root,
    "a",
    { "index.ts": "export const a=1;" },
    { "@forma/b": "workspace:*" },
  );
  workspace(
    root,
    "b",
    { "index.ts": "export const b=1;" },
    { "@forma/a": "workspace:*" },
  );
  expect(() => checkDependencies(root)).toThrow(/cycle/);
});
