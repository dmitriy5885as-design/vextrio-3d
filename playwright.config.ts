import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  // Software WebGL shares the runner CPU; avoid competing render threads
  // turning full modelling scenarios into machine-load timeouts.
  workers: process.env.CI ? 1 : undefined,
  use: {
    baseURL: "http://127.0.0.1:5173",
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      channel: process.env.PLAYWRIGHT_CHANNEL,
      args: ["--use-angle=swiftshader", "--enable-webgl"],
    },
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
  },
  reporter: "list",
});
