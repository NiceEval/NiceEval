import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";

export const deterministicAgent = defineAgent({
  name: "runner-deterministic",
  evidenceCoverage: {
    ...completeEvidenceCoverage,
    usage: { status: "unavailable", reason: "deterministic fixture has no token usage" },
  },
  async send(_input, ctx) {
    if (ctx.signal.aborted) throw new Error("runner fixture aborted");
    return {
      status: "completed",
      events: [{ type: "message", role: "assistant", text: "runner-fixture-ok" }],
    };
  },
});
