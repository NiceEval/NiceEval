import { defineExperiment } from "niceeval";
import { openClawAgent } from "niceeval/adapter";
import { sandbox } from "../sandbox.ts";

// 与 bub 同源的 OpenAI 兼容网关:写 baseUrl 时 Adapter 注册 compat provider。
const agent = openClawAgent({
  apiKey: process.env.BUB_API_KEY,
  baseUrl: process.env.BUB_API_BASE,
});

export default defineExperiment({
  description: "openclaw: Docker 沙箱内真实 CLI 协议闭环",
  agent,
  model: "gpt-5.6-luna",
  sandbox,
  evals: (e) =>
    e.id.startsWith("assertion-contract/") ||
    ["coding-task/write-and-verify", "session/recall", "usage/tokens"].includes(e.id),
  attempts: 1,
});
