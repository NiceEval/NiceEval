import { completeEvidenceCoverage, defineAgent, type Agent } from "niceeval/adapter";

/** Deterministic first-party Inspection fixture; it never contacts a provider. */
export function deterministicAgent(): Agent {
  return defineAgent({
    name: "inspection-fixture",
    evidenceCoverage: completeEvidenceCoverage,
    async send(_input, ctx) {
      if (ctx.signal.aborted) throw new Error("inspection fixture aborted");
      ctx.session.capture("inspection-fixture");
      return {
        status: "completed",
        evidenceCoverage: {
          messages: {
            status: "partial",
            reason: "fixture conversation history is intentionally partial",
          },
        },
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          requests: 1,
        },
        events: [
          {
            type: "message",
            role: "assistant",
            text: "Deterministic inspection fixture response.",
          },
        ],
      };
    },
  });
}
