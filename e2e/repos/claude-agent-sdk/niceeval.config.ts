import { defineConfig } from "niceeval";

export default defineConfig({
  name: { "zh-CN": "e2e: claude-agent-sdk (fromClaudeSdkMessages)", en: "e2e: claude-agent-sdk (fromClaudeSdkMessages)" },
  timeoutMs: 120_000,
  // 每个 attempt 都要经一个真实子进程(src/backend/server.ts)+ Claude Code CLI 子进程 +
  // 真实网络调用。钉死串行(不是"偏保守",是必须):两个并发的 HITL 审批打到同一个 server
  // 实例时,POST /api/chat/approve 会对其中一个 toolUseId 永久 404(canUseTool 的 resolver
  // 还没注册上),源头见 examples/zh/tier1/claude-sdk 的同一条注释。
  maxConcurrency: 1,
});
