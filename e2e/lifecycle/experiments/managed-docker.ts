import { defineExperiment } from "niceeval";
import { managedProcessAgent, managedProcessDockerSandbox } from "../agents/deterministic.ts";

export default defineExperiment({
  description: "Docker managed process lifecycle",
  agent: managedProcessAgent,
  sandbox: managedProcessDockerSandbox,
  evals: ["managed-process"],
});
