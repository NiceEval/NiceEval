import { defineExperiment } from "niceeval";
import { dockerSandbox } from "niceeval/sandbox";
import { sandboxStepActivityAgent } from "../agents/sandbox-step-activity.ts";

export default defineExperiment({
  description: "Runtime TTY feedback for declarative Sandbox steps",
  agent: sandboxStepActivityAgent,
  sandbox: dockerSandbox({
    source: {
      type: "dockerfile",
      context: new URL("../fixtures/sandbox-step-activity/", import.meta.url),
    },
    user: "node",
    resources: { cpus: 1, memoryBytes: 512 * 1024 ** 2, pidsLimit: 128 },
  }),
  evals: ["sandbox-step-activity/display"],
});
