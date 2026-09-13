import { defineConfig } from "niceeval";

export default defineConfig({
  name: { "zh-CN": "Claude Agent SDK 示例", en: "Claude Agent SDK example" },
  judgeRuntime: { model: "gpt-5.4" },
  timeoutMs: 120_000,
  // 每个 attempt 都要经一个真实子进程(server.ts)+ Claude Code CLI 子进程 + 网络调用。
  // 钉死串行(不是"偏保守",是必须):同一 model 分桶下两个并发的
  // HITL 审批打到同一个 server 实例时,POST /api/chat/approve 会对其中一个 toolUseId
  // 永久 404(canUseTool 的 resolver 没注册成功),见 memory/claude-sdk-concurrent-hitl-approve-race.md。
  maxConcurrency: 1,
});
