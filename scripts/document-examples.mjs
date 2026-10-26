import { build } from "vite";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
const output = resolve("test-results/document-corpus");
await build({
  configFile: false,
  logLevel: "warn",
  build: {
    target: "node22",
    outDir: output,
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: resolve("tests/fixtures/v2-project.ts"),
      formats: ["cjs"],
      fileName: () => "examples.cjs",
    },
  },
});
const { documentExamples } = createRequire(import.meta.url)(
  resolve(output, "examples.cjs"),
);
mkdirSync("tests/fixtures/v2", { recursive: true });
for (const [name, text] of Object.entries(documentExamples())) {
  writeFileSync(`tests/fixtures/v2/${name}.v3d`, text + "\n");
  const p = JSON.parse(text),
    g = Object.values(p.geometries)[0];
  console.log(name, {
    vertices: Object.keys(g.vertices).length,
    edges: Object.keys(g.edges).length,
    faces: Object.keys(g.faces).length,
    loops: Object.keys(g.loops).length,
  });
}
