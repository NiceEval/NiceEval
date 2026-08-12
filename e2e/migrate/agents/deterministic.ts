import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";

export const deterministicAgent = defineAgent({
  name: "migrate-handoff-deterministic",
  evidenceCoverage: completeEvidenceCoverage,
  async send(input, context) {
    if (context.signal.aborted) throw new Error("deterministic migrate agent aborted");
    context.session.capture("migrate-handoff-session");
    return {
      status: "completed" as const,
      events: [
        {
          type: "message" as const,
          role: "assistant" as const,
          text: `persisted-handoff:${input.text}`,
        },
      ],
      data: { marker: "migrate-handoff-v1" },
      usage: { inputTokens: 1, outputTokens: 1, costUSD: 0 },
    };
  },
});
