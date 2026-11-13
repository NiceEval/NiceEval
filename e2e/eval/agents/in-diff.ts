import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
import { shell } from "niceeval/sandbox";
export const inDiffAgent = defineSandboxAgent({
  name: "in-diff-fixture",
  evidenceCoverage: completeEvidenceCoverage,
  install: { identity: { agent: "in-diff-fixture", version: "1", revision: "1" }, probe: shell("true") },
  async send(input, ctx) {
    if (input.text === "change") {
      await ctx.sandbox.writeText("fixture/content.txt", `unchanged-context-token\n${"x".repeat(2000)}added-content-token\n`);
      await ctx.sandbox.writeText("fixture/path-token.txt", "ordinary\n");
    } else if (input.text === "binary") {
      await ctx.sandbox.writeBytes("fixture/binary.bin", new Uint8Array([0, 1, 2, 3]));
    }
    return { status: "completed" as const, events: [{ type: "message" as const, role: "assistant" as const, text: "done" }] };
  },
});
