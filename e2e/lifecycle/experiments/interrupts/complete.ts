import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineExperiment } from "niceeval";
import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";

export const siblingCompleteMarker = ".niceeval-lifecycle-sibling-complete";

const siblingAgent = defineAgent({
  name: "lifecycle-direct-sibling",
  evidenceCoverage: {
    ...completeEvidenceCoverage,
    usage: { status: "unavailable", reason: "deterministic fixture has no token usage" },
  },
  async send() {
    return {
      status: "completed",
      events: [{ type: "message", role: "assistant", text: "lifecycle-fixture-ok" }],
    };
  },
});

/** The independently sealed sibling in the SIGINT publication lifecycle case. */
export default defineExperiment({
  description: "complete sibling Run before the interrupted Run is stopped",
  // This Run is a publication barrier, not a second Docker lifecycle subject.
  // Keeping it direct prevents cold-provision contention from delaying the
  // point at which the test interrupts the separately reused Docker Sandbox.
  agent: siblingAgent,
  evals: ["probe"],
  teardown: async () => {
    // Test-only synchronization seam: teardown starts only after this
    // Experiment's Attempt and Eval have settled. Invocation progress remains
    // a sampled heartbeat and is deliberately not used as a barrier.
    await writeFile(join(process.cwd(), siblingCompleteMarker), "complete\n", "utf8");
  },
});
