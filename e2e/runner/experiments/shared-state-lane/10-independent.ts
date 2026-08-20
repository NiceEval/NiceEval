import { defineExperiment } from "niceeval";
import { localSandbox } from "niceeval/sandbox";
import { sharedStateExclusiveLaneAgent } from "../../agents/shared-state.ts";

export default defineExperiment({
  agent: sharedStateExclusiveLaneAgent,
  flags: { role: "lane-independent" },
  sandbox: localSandbox({ dir: process.cwd() }),
  evals: ["shared-state/"],
});
