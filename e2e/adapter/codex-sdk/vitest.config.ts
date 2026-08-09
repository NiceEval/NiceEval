import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // This is a single paid live compatibility attempt, never a Vitest retry.
    retry: 0,
    testTimeout: 14 * 60_000,
    hookTimeout: 30_000,
  },
});
