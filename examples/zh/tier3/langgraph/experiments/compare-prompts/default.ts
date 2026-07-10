import { defineExperiment } from "niceeval";
import agent from "../../agents/langgraph.ts";

// compare-prompts 组的一格:不带 flags,应用走自己的默认 system prompt——A/B 的对照组。
export default defineExperiment({
  description: "default: 应用默认 system prompt",
  agent,
  runs: 1,
});
