import { defineConfig } from "niceeval";

export default defineConfig({
  name: { "zh-CN": "bub E2E", en: "bub E2E" },
  // 沙箱型 agent 的首次 attempt 要装 bub(uv 拉 python 3.12 工具链 + 两个 git+https
  // 依赖），比纯 Direct Agent 慢得多；后续 attempt 靠模块内 checkpoint 缓存加速，但第一次
  // 仍需要充裕的时间预算。
  timeoutMs: 300_000,
  maxConcurrency: 4,
});
