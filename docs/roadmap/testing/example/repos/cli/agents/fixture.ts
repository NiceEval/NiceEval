import { completeEvidenceCoverage, defineDirectAgent } from "niceeval/adapter";

export const fixtureAgent = defineDirectAgent({
  name: "fixture",
  evidenceCoverage: completeEvidenceCoverage,
  async send() {
    return {
      status: "completed",
      events: [{ type: "message", role: "assistant", text: "fixture-ready" }],
    };
  },
});
