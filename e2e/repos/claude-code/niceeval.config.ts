import { defineConfig } from "niceeval";
import { dockerSandbox } from "niceeval/sandbox";

export default defineConfig({
  name: { "zh-CN": "e2e: claude-code(沙箱型内置 agent,docker)", en: "e2e: claude-code (built-in sandbox agent, docker)" },
  judge: { model: "deepseek-v4-pro" },
  // 默认镜像(node:24-slim)够用:这套 eval 只建/改文件、跑 shell、装 skill/MCP/plugin,
  // 不需要 python。
  sandbox: dockerSandbox(),
  // 沙箱型 agent 每个 attempt 都是全新容器,要重装 CLI(+ setup 阶段的 skills/MCP/plugin);
  // 挂了 MCP/plugin 的 agent 还要等 npx 下载依赖,10 分钟放足余量。
  timeoutMs: 600_000,
  // 沙箱贵:限制并发,避免本机/CI runner 同时起太多容器抢 CPU。
  maxConcurrency: 2,
});
