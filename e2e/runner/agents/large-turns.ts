import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";

export const largeTurnsAgent = defineAgent({
  name: "large-turns",
  evidenceCoverage: completeEvidenceCoverage,
  async send() {
    return {
      status: "completed",
      events: Array.from({ length: 48 }, (_, index) => ({
        type: "message" as const,
        role: "assistant" as const,
        text: `${index}:` + "界".repeat(6000) + "\u0000\ud800",
      })),
    };
  },
});
