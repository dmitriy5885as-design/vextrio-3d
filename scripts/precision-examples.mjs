import { build } from "vite";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const output = resolve("test-results/precision-corpus");
await build({
  configFile: false,
  logLevel: "warn",
  build: {
    target: "node22",
    outDir: output,
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: resolve("tests/fixtures/precision-examples.ts"),
      formats: ["cjs"],
      fileName: () => "examples.cjs",
    },
  },
});
const { createPrecisionExamples } = createRequire(import.meta.url)(
  resolve(output, "examples.cjs"),
);
const { project, examples } = createPrecisionExamples();
writeFileSync("tests/fixtures/v2/precision.v3d", project + "\n");
writeFileSync(
  "docs/0.2/S5_EXAMPLES.json",
  JSON.stringify(examples, null, 2) + "\n",
);
console.log(examples);
