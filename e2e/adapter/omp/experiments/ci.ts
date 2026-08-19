import { defineExperiment } from "niceeval";
import { ompAgent } from "niceeval/adapter";
import { sandbox } from "../sandbox.ts";

const agent = ompAgent({
  apiKey: process.env.BUB_API_KEY,
  baseUrl: process.env.BUB_API_BASE,
});

export default defineExperiment({
  description: "OMP adapter 的目标兼容性闭环",
  agent,
  model: "gpt-5.6-luna",
  sandbox,
  evals: ["message"],
  attempts: 1,
});
