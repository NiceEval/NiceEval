import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
import type { Agent } from "niceeval/adapter";

/**
 * The Report Repo's backend fixture. It emits one stable assistant message and never
 * reads environment variables or contacts a provider.
 */
export function deterministicAgent(name: string, costUSD = 0.01): Agent {
  return defineAgent({
    name,
    evidenceCoverage: completeEvidenceCoverage,
    async send(_input, ctx) {
      if (ctx.signal.aborted) throw new Error("report fixture aborted");
      ctx.session.capture(`report-fixture:${name}`);
      const operationId = "report-write-1";
      return {
        status: "completed",
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          requests: 1,
          costUSD,
        },
        events: [
          {
            type: "operation.started",
            operationId,
            operation: {
              kind: "tool",
              name: "write_file",
              input: { path: "report-notes.txt", content: "report-execution-sentinel-914" },
            },
          },
          {
            type: "operation.finished",
            operationId,
            kind: "tool",
            output: { written: true },
            status: "completed",
          },
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
