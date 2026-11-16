import { defineConfig } from "vitest/config";

const sourceCandidate = (process.env.NODE_OPTIONS ?? "").split(/\s+/).includes("--conditions=niceeval-source");

export default defineConfig({
  // Vite does not inherit Node's custom export conditions. Vitest also resets each environment's defaults.
  plugins: sourceCandidate
    ? [
        {
          name: "niceeval-source-candidate",
          configEnvironment(_name, config) {
            return {
              resolve: {
                conditions: [
                  "niceeval-source",
                  ...(config.resolve?.conditions ?? ["module", "node", "development|production"]),
                ],
              },
            };
          },
        },
      ]
    : [],
  test: {
    include: ["test/**/*.test.ts"],
    // 每个 owner 使用独立项目副本与动态端口，保留 Vitest 默认文件级并行。
    testTimeout: 2 * 60_000,
    hookTimeout: 60_000,
  },
});
