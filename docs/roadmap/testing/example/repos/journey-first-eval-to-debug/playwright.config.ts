import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test",
  testMatch: "**/*.test.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    browserName: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  outputDir: "test-results",
});
