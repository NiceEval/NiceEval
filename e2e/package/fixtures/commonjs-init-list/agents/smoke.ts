import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";

export const smokeAgent = defineAgent({
  name: "package-smoke",
  evidenceCoverage: completeEvidenceCoverage,
  async send() {
    return {
      status: "completed",
      events: [{ type: "message", role: "assistant", text: "package smoke" }],
    };
  },
});
