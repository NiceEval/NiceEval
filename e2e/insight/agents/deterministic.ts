import { Effect } from "effect";
import { completeEvidenceCoverage, defineSandboxAgent, type Agent } from "niceeval/adapter";
import { CustomSandboxMaterializationError, defineSandbox, shell } from "niceeval/sandbox";
import { createInspectionProcessSandbox } from "./process-sandbox.ts";

export const deterministicSandbox = defineSandbox({
  name: "inspection-process-e2e",
  targetPlatform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
  exclusive: true,
  create: () => Effect.tryPromise({
    try: () => createInspectionProcessSandbox(),
    catch: (cause) => {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      return new CustomSandboxMaterializationError({
        code: "inspection-process-sandbox-create-failed",
        message: error.message,
        cause: error,
      });
    },
  }),
});

/** Deterministic first-party Inspection fixture; it never contacts a provider. */
export function deterministicAgent(): Agent {
  return defineSandboxAgent({
    name: "inspection-fixture",
    evidenceCoverage: completeEvidenceCoverage,
    ensure: {
      identity: { agent: "inspection-fixture", version: "1", revision: "1" },
      probe: shell("true"),
    },
    send: async (_input, ctx) => {
      if (ctx.signal.aborted) throw new Error("inspection fixture aborted");
      await ctx.sandbox.writeText("inspection-agent-change.txt", "inspection diff evidence\n");
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
            type: "operation.started",
            operationId: "inspection-tool-1",
            operation: {
              kind: "tool",
              name: "inspection_fixture",
              input: { marker: "inspection-tool-input" },
            },
          },
          {
            type: "operation.finished",
            operationId: "inspection-tool-1",
            kind: "tool",
            output: { marker: "inspection-tool-result" },
            status: "completed",
          },
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
