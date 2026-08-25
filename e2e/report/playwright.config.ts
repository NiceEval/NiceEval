import { defineConfig, devices } from "@playwright/test";

const chromiumExecutablePath = process.env.CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: "test",
  testMatch: "**/*.browser.spec.ts",
  timeout: 120_000,
  retries: 0,
  reporter: "list",
  use: {
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
