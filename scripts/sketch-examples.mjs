import { build } from "vite";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
// Build a pure geometry harness, not the editor or a Three.js scene.
const output = resolve("test-results/sketch-corpus");
await build({
  configFile: false,
  logLevel: "warn",
  build: {
    target: "node22",
    outDir: output,
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: resolve("tests/fixtures/sketch-examples.ts"),
      formats: ["cjs"],
      fileName: () => "examples.cjs",
    },
  },
});
const { createSketchExamples } = createRequire(import.meta.url)(
  resolve(output, "examples.cjs"),
);
const corpus = createSketchExamples();
writeFileSync(
  "docs/0.2/S3_EXAMPLES.json",
  JSON.stringify(corpus, null, 2) + "\n",
);
console.log(
  corpus.cases.map((c) => ({ name: c.name, counts: c.counts, areas: c.areas })),
);
