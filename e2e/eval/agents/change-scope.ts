import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
import { shell } from "niceeval/sandbox";

export const changeScopeAgent = defineSandboxAgent({
  name: "change-scope-fixture",
  evidenceCoverage: completeEvidenceCoverage,
  install: { identity: { agent: "change-scope-fixture", version: "1", revision: "1" }, probe: shell("true") },
  async send(input, ctx) {
    if (input.text === "change") {
      await ctx.sandbox.writeText("agents/a.ts", "allowed\n");
      await ctx.sandbox.writeText("single.ts", "exact\n");
      await ctx.sandbox.writeText("agents-old/outside.ts", "outside\n");
      await ctx.sandbox.writeText("ignored.txt", "ignored\n");
    }
    return {
      status: "completed" as const,
      events: [{ type: "message" as const, role: "assistant" as const, text: "done" }],
    };
  },
});
