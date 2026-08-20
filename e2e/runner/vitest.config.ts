import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Runner cases spend most of their wall time waiting on isolated child
    // processes. Keep enough file workers to exercise that intended parallelism
    // on the two-vCPU CI host instead of serializing I/O behind the CPU count.
    maxWorkers: 4,
    testTimeout: 240_000,
    hookTimeout: 120_000,
  },
});
