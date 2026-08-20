import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Runner cases spend most of their wall time waiting on isolated child
    // processes. Use two file workers per public-runner vCPU so long lifecycle
    // files start early instead of sitting behind other I/O-bound owners.
    maxWorkers: 8,
    testTimeout: 240_000,
    hookTimeout: 120_000,
  },
});
