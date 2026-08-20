import { defineExperiment } from "niceeval";
import { managedProcessAgent, managedProcessLocalSandbox } from "../agents/deterministic.ts";

export default defineExperiment({
  description: "Local managed process lifecycle",
  agent: managedProcessAgent,
  sandbox: managedProcessLocalSandbox,
  evals: ["managed-process"],
});
