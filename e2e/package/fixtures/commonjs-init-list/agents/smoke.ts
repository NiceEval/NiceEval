import { Effect } from "effect";
import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";

export const smokeAgent = defineAgent({
  name: "package-smoke",
  evidenceCoverage: completeEvidenceCoverage,
  send: () => Effect.succeed({
    status: "completed",
    events: [{ type: "message", role: "assistant", text: "package smoke" }],
  }),
});
