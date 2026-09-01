import { Effect } from "effect";
import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
import { shell } from "niceeval/sandbox";

export const sandboxStepActivityAgent = defineSandboxAgent({
  name: "cli-sandbox-step-activity",
  evidenceCoverage: {
    ...completeEvidenceCoverage,
    usage: { status: "unavailable", reason: "deterministic fixture does not report token usage" },
  },
  ensure: {
    identity: { agent: "cli-sandbox-step-activity", version: "1", revision: "1" },
    probe: shell("true"),
  },
  send: () => Effect.sync(() => {
    return {
      status: "completed" as const,
      events: [{ type: "message" as const, role: "assistant" as const, text: "sandbox steps completed" }],
    };
  }),
});
