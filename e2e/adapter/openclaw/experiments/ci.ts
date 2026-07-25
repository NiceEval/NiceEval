import { defineExperiment } from "niceeval";
import { openClawAgent } from "niceeval/adapter";

// 与 bub 同源的 OpenAI 兼容网关:写 baseUrl 时 Adapter 注册 compat provider。
const agent = openClawAgent({
  apiKey: process.env.OPENCLAW_API_KEY ?? process.env.BUB_API_KEY,
  baseUrl: process.env.OPENCLAW_BASE_URL ?? process.env.BUB_API_BASE,
});

export default defineExperiment({
  description: "openclaw: Docker 沙箱内真实 CLI 协议闭环",
  agent,
  model: "gpt-5.6-luna",
  evals: ["coding-task/write-and-verify", "session/recall", "usage/tokens"],
  runs: 1,
});
