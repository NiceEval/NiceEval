import { defineExperiment } from "niceeval";
import { dockerSandbox } from "niceeval/sandbox";
import { sandboxActionDebugAgent } from "../agents/sandbox-action-debug.ts";
import { plannedDebugAction } from "../src/sandbox-action-debug.ts";

const sandbox = dockerSandbox({
  source: {
    type: "image",
    image: "node@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f",
  },
  resources: { readOnlyRootfs: true },
})
  .before(plannedDebugAction("dependency-root", 5))
  .before(plannedDebugAction("invalid-cycle-a", 10, ["invalid-cycle-b"]))
  .before(plannedDebugAction("invalid-cycle-b", 10, ["invalid-cycle-a"]));

export default defineExperiment({
  description: "Invalid Sandbox action DAG debug attribution",
  agent: sandboxActionDebugAgent,
  sandbox,
  evals: ["sandbox-action-debug/plan"],
});
