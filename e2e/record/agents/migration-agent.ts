import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";

export const migrationAgent = defineAgent({
  name: "record-migration-agent",
  evidenceCoverage: completeEvidenceCoverage,
  async send(input, context) {
    context.session.capture("record-migration-agent-session");
    return {
      status: "completed" as const,
      events: [{ type: "message" as const, role: "assistant" as const, text: `agent:${input.text}` }],
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costUSD: 0,
      },
    };
  },
});
