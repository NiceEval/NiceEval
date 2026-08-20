import { completeEvidenceCoverage, defineAgent } from "niceeval-legacy-0-13/adapter";

export const legacyDeterministicAgent = defineAgent({
  name: "migrate-handoff-legacy-deterministic",
  evidenceCoverage: completeEvidenceCoverage,
  async send(input, context) {
    if (context.signal.aborted) throw new Error("deterministic migrate agent aborted");
    context.session.capture("migrate-handoff-legacy-session");
    return {
      status: "completed" as const,
      events: [{
        type: "message" as const,
        role: "assistant" as const,
        text: `persisted-handoff:${input.text}`,
      }],
      data: { marker: "migrate-handoff-legacy" },
      usage: { inputTokens: 1, outputTokens: 1, costUSD: 0 },
    };
  },
});
