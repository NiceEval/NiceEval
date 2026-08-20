import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineExperiment } from "niceeval";
import { lifecycleSandbox, quickAgent } from "../../agents/deterministic.ts";

export const siblingCompleteMarker = ".niceeval-lifecycle-sibling-complete";

/** The independently sealed sibling in the SIGINT publication lifecycle case. */
export default defineExperiment({
  description: "complete sibling Run before the interrupted Run is stopped",
  agent: quickAgent,
  sandbox: lifecycleSandbox,
  evals: ["probe"],
  teardown: async () => {
    // Test-only synchronization seam: teardown starts only after this
    // Experiment's Attempt and Eval have settled. Invocation progress remains
    // a sampled heartbeat and is deliberately not used as a barrier.
    await writeFile(join(process.cwd(), siblingCompleteMarker), "complete\n", "utf8");
  },
});
