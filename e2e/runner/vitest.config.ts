import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Runner cases spend most of their wall time waiting on isolated child
    // processes. Keep four file workers explicit on the public GitHub-hosted
    // runner so environment-derived defaults cannot serialize this I/O workload.
    maxWorkers: 4,
    testTimeout: 240_000,
    hookTimeout: 120_000,
  },
});
