import { defineExperiment } from "niceeval";
import { hermesAgent } from "niceeval/adapter";
import { sandbox } from "../sandbox.ts";

// 与 bub 同源的 OpenAI 兼容网关。
const agent = hermesAgent({
  apiKey: process.env.OPENAI_API_KEY,
  baseUrl: process.env.OPENAI_BASE_URL,
  skills: [
    { kind: "local", path: "skills/niceeval-hermes-incident-report", name: "niceeval-hermes-incident-report" },
    { kind: "local", path: "skills/niceeval-hermes-decoy", name: "niceeval-hermes-decoy" },
  ],
});

export default defineExperiment({
  description: "hermes: Docker 沙箱内真实 CLI 协议闭环",
  agent,
  model: "gpt-5.6-luna",
  sandbox,
  evals: ["coding-task/write-and-verify", "skills/selected", "session/recall", "usage/tokens"],
  attempts: 1,
});
