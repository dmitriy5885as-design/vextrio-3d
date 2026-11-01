import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url),
  source = dirname(require.resolve("occt-import-js"));
mkdirSync("public/cad", { recursive: true });
for (const name of [
  "occt-import-js.js",
  "occt-import-js.wasm",
  "license.occt.txt",
  "license.occt-import-js.txt",
])
  copyFileSync(join(source, name), join("public/cad", name));
