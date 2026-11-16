import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
import { shell } from "niceeval/sandbox";
export default defineSandboxAgent({
  name: "diff-body",
  evidenceCoverage: completeEvidenceCoverage,
  install: { identity: { agent: "diff-body", version: "1", revision: "1" }, probe: shell("true") },
  async send(_input, ctx) {
    await ctx.sandbox.writeText("small.txt", "after\n");
    await ctx.sandbox.writeText("large.txt", "新".repeat(10000) + "\n");
    await ctx.sandbox.writeText("binary.txt", "now text\n");
    return { status: "completed", events: [] };
  },
});
