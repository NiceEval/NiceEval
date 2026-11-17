import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";

export const largeTurnsAgent = defineAgent({
  name: "large-turns",
  evidenceCoverage: {
    ...completeEvidenceCoverage,
    ...(process.env.NICEEVAL_LARGE_COVERAGE === "1"
      ? {
          data: { status: "partial" as const, reason: "Coverage unavailable.\u0000\ud800" + "界".repeat(6000) },
        }
      : {}),
  },
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
