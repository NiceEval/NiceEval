import { Effect } from "effect";
import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";

export const timingAgent = defineAgent({
  name: "runner-timing",
  evidenceCoverage: {
    ...completeEvidenceCoverage,
    usage: { status: "unavailable", reason: "deterministic fixture has no token usage" },
  },
  setup: (ctx) => Effect.sync(() => {
    if (ctx.signal.aborted) throw new Error("runner timing fixture setup aborted");
  }),
  send: (_input, ctx) => Effect.tryPromise({
      try: async () => {
    if (ctx.signal.aborted) throw new Error("runner timing fixture send aborted");
    return {
      status: "completed",
      events: [{ type: "message", role: "assistant", text: "runner-timing-ok" }],
    };

      },
      catch: (cause) => cause,
    }),
});
