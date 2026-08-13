import { defineConfig } from "niceeval";

export default defineConfig({
  name: { "zh-CN": "e2e: claude-code(沙箱型内置 agent,docker)", en: "e2e: claude-code (built-in sandbox agent, docker)" },
  // 沙箱型 agent 每个 attempt 都是全新容器;CLI 已随镜像预装,但 setup 阶段的
  // skills/MCP/plugin 仍要装,挂了 MCP/plugin 的 agent 还要等 npx 下载依赖,10 分钟放足余量。
  timeoutMs: 600_000,
  maxConcurrency: 4,
});
