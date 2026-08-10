import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 5 * 60_000,
    hookTimeout: 60_000,
  },
});
