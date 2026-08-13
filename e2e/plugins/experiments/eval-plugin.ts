import { defineExperiment } from "niceeval";
import { pluginAgent, pluginSandbox } from "../agents/deterministic.ts";

export default defineExperiment({
  agent: pluginAgent,
  sandbox: pluginSandbox,
  evals: ["eval-plugin"],
  attempts: 2,
  maxConcurrency: 1,
});
