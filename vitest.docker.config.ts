import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "docker",
    include: ["src/**/*.docker.test.ts"],
  },
});
