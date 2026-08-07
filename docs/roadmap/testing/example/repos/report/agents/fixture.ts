import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";

export const fixtureAgent = defineAgent({
  name: "fixture",
  evidenceCoverage: completeEvidenceCoverage,
  async send() {
    return {
      status: "completed",
      events: [{ type: "message", role: "assistant", text: "fixture-ready" }],
    };
  },
});
