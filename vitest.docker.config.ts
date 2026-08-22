import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "docker",
    include: ["packages/niceeval/src/**/*.docker.test.ts"],
  },
});
