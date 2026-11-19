import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      name: "niceeval-source-condition",
      configEnvironment(_name, config) {
        if (!process.env.NODE_OPTIONS?.includes("--conditions=niceeval-source")) return;
        return { resolve: { conditions: ["niceeval-source", ...(config.resolve?.conditions ?? [])] } };
      },
    },
  ],
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 240_000,
    hookTimeout: 120_000,
  },
});
