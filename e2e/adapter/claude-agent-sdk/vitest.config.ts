import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    retry: 0,
    testTimeout: 14 * 60_000,
    hookTimeout: 30_000,
  },
});
