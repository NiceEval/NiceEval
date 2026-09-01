import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Lifecycle cases launch real Docker/Incus process trees. Keep case-level
    // concurrency bounded so their own concurrency assertions are not starved
    // by unrelated builds and capture cleanup on shared CI hosts.
    maxConcurrency: 2,
    // Process-level owners keep narrower deadlines. This outer budget must
    // still cover multi-invocation Docker journeys under default parallel CI.
    testTimeout: 600_000,
    hookTimeout: 120_000,
  },
});
