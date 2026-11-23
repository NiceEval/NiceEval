import { defineExperiment } from "niceeval";
import { deepSeekHarnessAgent } from "niceeval/adapter";
import { DSH_PLUGIN } from "../evals/plugin-probe.ts";
import { sandbox } from "../sandbox.ts";

const agent = deepSeekHarnessAgent({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseUrl: process.env.DEEPSEEK_BASE_URL,
  plugins: [`${DSH_PLUGIN.name}@${DSH_PLUGIN.version}`],
});

export default defineExperiment({
  description: "DeepSeek Harness adapter 的目标兼容性闭环",
  adapter: agent,
  model: "deepseek-v4.1-flash",
  sandbox,
  evals: ["message"],
  attempts: 1,
});
