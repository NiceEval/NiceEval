import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Process-level owners keep narrower deadlines. This outer budget must
    // still cover multi-invocation Docker journeys under default parallel CI.
    testTimeout: 600_000,
    hookTimeout: 120_000,
  },
});
