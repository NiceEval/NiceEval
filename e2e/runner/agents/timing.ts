import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";

export const timingAgent = defineAgent({
  name: "runner-timing",
  evidenceCoverage: {
    ...completeEvidenceCoverage,
    usage: { status: "unavailable", reason: "deterministic fixture has no token usage" },
  },
  setup(ctx) {
    if (ctx.signal.aborted) throw new Error("runner timing fixture setup aborted");
  },
  async send(_input, ctx) {
    if (ctx.signal.aborted) throw new Error("runner timing fixture send aborted");
    return {
      status: "completed",
      events: [{ type: "message", role: "assistant", text: "runner-timing-ok" }],
    };
  },
});
