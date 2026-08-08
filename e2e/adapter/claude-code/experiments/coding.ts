import { defineExperiment } from "niceeval";
import { claudeCodeAgent } from "niceeval/adapter";
import { sandbox } from "../sandbox.ts";

const agent = claudeCodeAgent({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseUrl: process.env.ANTHROPIC_BASE_URL,
});

// 基线 agent 一次运行同时验收共享断言契约与 Claude Code 会话/工具协议。
export default defineExperiment({
  description: "coding:共享断言契约 + Claude Code 基线会话/工具协议",
  agent,
  model: "gpt-5.6-luna",
  sandbox,
  attempts: 1,
  evals: (e) => e.id.startsWith("assertion-contract/") || e.id === "session-resume",
});
