import { defineExperiment } from "niceeval";
import { managedProcessAgent, managedProcessSandbox } from "../agents/deterministic.ts";

export default defineExperiment({
  description: "Docker managed process lifecycle",
  agent: managedProcessAgent,
  sandbox: managedProcessSandbox,
  evals: ["managed-process"],
});
