import { defineConfig, devices } from "@playwright/test";

// 开发机没有 Playwright 自带浏览器所需系统库时（如 NixOS），用 CHROMIUM_EXECUTABLE_PATH
// 指向可运行的 chromium 二进制；CI 与普通环境不设该变量，行为不变。
const chromiumExecutablePath = process.env.CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: "test",
  testMatch: "**/*.browser.spec.ts",
  timeout: 60_000,
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
