import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 8 * 60_000,
    hookTimeout: 120_000,
  },
});
