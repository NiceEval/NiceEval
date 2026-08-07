import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
import type { Agent } from "niceeval/adapter";

/**
 * The Report Repo's backend fixture. It emits one stable assistant message and never
 * reads environment variables or contacts a provider.
 */
export function deterministicAgent(name: string): Agent {
  return defineAgent({
    name,
    evidenceCoverage: completeEvidenceCoverage,
    async send(_input, ctx) {
      if (ctx.signal.aborted) throw new Error("report fixture aborted");
      ctx.session.capture(`report-fixture:${name}`);
      return {
        status: "completed",
        events: [
          {
            type: "message",
            role: "assistant",
            text: "Deterministic report fixture response.",
          },
        ],
      };
    },
  });
}
