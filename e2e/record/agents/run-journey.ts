import { Effect } from "effect";
import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";

export const runJourneyAgent = defineAgent({
  name: "run-journey-deterministic",
  evidenceCoverage: {
    ...completeEvidenceCoverage,
    usage: { status: "unavailable", reason: "deterministic fixture has no token usage" },
  },
  send(_input, ctx) {
    const endpoint = ctx.flags.endpoint;
    const attemptIndex = ctx.attempt?.index;
    if (typeof endpoint !== "string" || endpoint.length === 0) {
      return Effect.fail(new Error("Run Journey Agent requires its backend endpoint"));
    }
    if (attemptIndex !== 0 && attemptIndex !== 1) {
      return Effect.fail(new Error(`unexpected Run Journey Attempt index: ${String(attemptIndex)}`));
    }
    return Effect.tryPromise({
      try: async () => {
        const response = await fetch(`${endpoint}/attempt/${attemptIndex}`, {
          method: "POST",
          signal: ctx.signal,
        });
        if (!response.ok) throw new Error(`Run Journey backend returned HTTP ${response.status}`);
        return await response.json() as {
          readonly status: "completed";
          readonly events: readonly [{ readonly type: "message"; readonly role: "assistant"; readonly text: string }];
        };
      },
      catch: (cause) => cause,
    });
  },
});
