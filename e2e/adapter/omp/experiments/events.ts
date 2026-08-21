import { defineExperiment } from "niceeval";
import { ompAgent } from "niceeval/adapter";
import { sandbox } from "../sandbox.ts";

const agent = ompAgent({
  apiKey: process.env.OPENAI_API_KEY,
  baseUrl: process.env.OPENAI_BASE_URL,
});

export default defineExperiment({
  description: "OMP adapter 的工具事件流与 usage 兼容性",
  agent,
  model: "gpt-5.6-luna",
  sandbox,
  evals: ["events"],
  attempts: 1,
});
