import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Runner cases spend most of their wall time waiting on isolated child
    // processes. Ten workers start the long recovery owner after at most one
    // short wave without overloading four-core CI with every file at once.
    maxWorkers: 10,
    testTimeout: 240_000,
    hookTimeout: 120_000,
  },
});
