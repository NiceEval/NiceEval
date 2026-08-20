import { defineExperiment } from "niceeval";
import { openCodeAgent } from "niceeval/adapter";
import { sandbox } from "../sandbox.ts";

// 与 bub 同源的 OpenAI 兼容网关:OpenCode 的 anthropic provider 接 DeepSeek
// Anthropic 兼容端点会 Unexpected server error,走 compat provider 才稳定。
const agent = openCodeAgent({
  apiKey: process.env.OPENAI_API_KEY,
  baseUrl: process.env.OPENAI_BASE_URL,
});

export default defineExperiment({
  description: "opencode: Docker 沙箱内真实 CLI 协议闭环",
  agent,
  model: "gpt-5.6-luna",
  sandbox,
  evals: ["coding-task/write-and-verify", "session/recall", "usage/tokens"],
  attempts: 1,
});
