import { defineExperiment } from "niceeval";
import { hermesAgent } from "niceeval/adapter";

// 与 bub 同源的 OpenAI 兼容网关。
const agent = hermesAgent({
  apiKey: process.env.HERMES_API_KEY ?? process.env.BUB_API_KEY,
  baseUrl: process.env.HERMES_API_BASE ?? process.env.BUB_API_BASE,
});

export default defineExperiment({
  description: "hermes: Docker 沙箱内真实 CLI 协议闭环",
  agent,
  model: "gpt-5.6-luna",
  evals: ["coding-task/write-and-verify", "session/recall", "usage/tokens"],
  runs: 1,
});
