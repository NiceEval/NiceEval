import { defineConfig } from "fasteval";

export default defineConfig({
  // Claude Code 需要隔离工作区,走 Docker 沙箱。
  sandbox: "docker",

  // 被测工作区:一个已经装好 effect 和 @effect/schema 的 TypeScript 项目。
  // 你可以换成自己的项目目录(相对路径)。
  workspace: "./workspaces/effect-ts-starter",

  // 评判模型:用便宜的模型做 judge,与被测 agent 解耦。
  judge: { model: "claude-haiku-4-5-20251001" },

  timeoutMs: 300_000,   // 300s:装 skill + 编码任务有时较慢
  maxConcurrency: 2,    // 同时跑 2 个 eval;避免 Docker 资源争抢
});
