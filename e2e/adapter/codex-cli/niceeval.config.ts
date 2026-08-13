import { defineConfig } from "niceeval";

export default defineConfig({
  name: { "zh-CN": "e2e: codex-cli (codexAgent, docker sandbox)", en: "e2e: codex-cli (codexAgent, docker sandbox)" },
  // 沙箱型 agent 每个 attempt 都是全新容器;CLI 已随镜像预装,但 setup 阶段的
  // skills/MCP/plugin 仍要装;实测本机单次 attempt 数十秒到数分钟,10 分钟放足余量。
  timeoutMs: 600_000,
  maxConcurrency: 4,
});
