import { defineExperiment } from "niceeval";
import { pluginDirectAgent } from "../agents/deterministic.ts";

export default defineExperiment({
  agent: pluginDirectAgent,
  evals: ["attempt-interruption/direct-agent-timeout"],
  attempts: 1,
  timeoutMs: 500,
});
