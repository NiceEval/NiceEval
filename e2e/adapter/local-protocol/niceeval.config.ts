import { defineConfig } from "niceeval";

export default defineConfig({
  name: {
    "zh-CN": "adapter/local-protocol：无密钥审批 / transport / 故障 / cleanup",
    en: "adapter/local-protocol: no-secret approval / transport / faults / cleanup",
  },
  // 本 Repo 不测 live 模型；默认 attempt 上限留给 hang 之外的场景足够裕度。
  // hang 场景由 experiments/timeout.ts 用更短的 experiment.timeoutMs 压过。
  timeoutMs: 30_000,
  maxConcurrency: 4,
});
