import { defineExperiment } from "niceeval";
import { deepSeekHarnessAgent } from "niceeval/adapter";
import { sandbox } from "../sandbox.ts";

const agent = deepSeekHarnessAgent({
  apiKey: process.env.DEEPSEEK_API_KEY,
  plugins: ["dsh-dead-links@0.1.1"],
});

export default defineExperiment({
  description: "DeepSeek Harness adapter 的目标兼容性闭环",
  agent,
  model: "deepseek-v4-flash",
  sandbox,
  evals: ["message"],
  attempts: 1,
});
