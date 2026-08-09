import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
import { shell } from "niceeval/sandbox";

const ensure = {
  identity: { agent: "eval-deterministic-sandbox", version: "1", revision: "1" },
  // The fixture itself is the executable boundary; this stable probe only
  // confirms that its selected local Sandbox can execute a command.
  probe: shell("true"),
};

/**
 * Deterministic coding boundary for the Sandbox case. It performs real Sandbox
 * operations; NiceEval's own ledger creates and evaluates the diff evidence.
 */
export const deterministicSandboxAgent = defineSandboxAgent({
  name: "eval-deterministic-sandbox",
  evidenceCoverage: completeEvidenceCoverage,
  ensure,
  async send(input, ctx) {
    if (ctx.signal.aborted) throw new Error("deterministic sandbox agent aborted");
    if (input.text !== "assertion/sandbox") {
      throw new Error(`unknown deterministic Sandbox input: ${JSON.stringify(input.text)}`);
    }

    await ctx.sandbox.writeText("fixture/changed.txt", "after-agent-change\n");
    await ctx.sandbox.writeText("fixture/created.txt", "created-by-agent\n");
    const remove = await ctx.sandbox.runShell("rm fixture/delete-me.txt && test -f fixture/changed.txt");
    if (remove.exitCode !== 0) throw new Error(`sandbox fixture cleanup failed: ${remove.stderr}`);

    ctx.session.capture("eval-sandbox-session");
    return {
      status: "completed" as const,
      events: [
        {
          type: "operation.started" as const,
          operationId: "sandbox-write-1",
          operation: {
            kind: "tool" as const,
            name: "workspace_edit",
            input: { changed: "fixture/changed.txt", created: "fixture/created.txt" },
          },
        },
        {
          type: "operation.finished" as const,
          operationId: "sandbox-write-1",
          kind: "tool" as const,
          output: { marker: "sandbox-write-complete" },
          status: "completed" as const,
        },
        { type: "message" as const, role: "assistant" as const, text: "sandbox-agent-complete" },
      ],
      data: { fixture: "assertion-sandbox", ok: true },
      usage: { inputTokens: 2, outputTokens: 3, costUSD: 0 },
    };
  },
});
