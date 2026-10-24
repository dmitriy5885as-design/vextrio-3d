import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
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
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: Object.fromEntries(
      names.map((n) => [
        `@forma/${n}`,
        fileURLToPath(new URL(`./packages/${n}/src/index.ts`, import.meta.url)),
      ]),
    ),
  },
  server: { strictPort: true },
  build: {
    outDir: "dist",
    rollupOptions: { output: { manualChunks: { three: ["three"] } } },
  },
});
