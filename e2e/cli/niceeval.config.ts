import { defineConfig } from "niceeval";

export default defineConfig({
  name: { "zh-CN": "cli E2E", en: "cli E2E" },
  timeoutMs: 60_000,
  sandboxCache: { setup: "bypass" },
  // 所有 Experiment 使用签入的进程内确定性 Direct Agent，不依赖网络或凭据。
  maxConcurrency: 4,
});
