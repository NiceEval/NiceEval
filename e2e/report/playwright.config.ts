import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const chromiumExecutablePath =
  process.env.CHROMIUM_EXECUTABLE_PATH ??
  (existsSync("/run/current-system/sw/bin/chromium") ? "/run/current-system/sw/bin/chromium" : undefined);

export default defineConfig({
  testDir: "test",
  testMatch: "**/*.browser.spec.ts",
  timeout: 180_000,
  retries: 0,
  reporter: "list",
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    ...(chromiumExecutablePath === undefined
      ? {}
      : { launchOptions: { executablePath: chromiumExecutablePath } }),
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
