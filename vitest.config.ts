import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
const names = [
  "shared",
  "document",
  "commands",
  "geometry",
  "editor",
  "viewport",
  "tools",
  "snapping",
  "file-io",
  "ui",
];
export default defineConfig({
  resolve: {
    alias: Object.fromEntries(
      names.map((n) => [
        `@forma/${n}`,
        fileURLToPath(new URL(`./packages/${n}/src/index.ts`, import.meta.url)),
      ]),
    ),
  },
  test: { include: ["tests/**/*.test.ts"] },
});
