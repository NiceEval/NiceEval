import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
import { e2bSandbox, shell } from "niceeval/sandbox";
export const snapshotSandbox = e2bSandbox({ template: "fixture" }).before(shell({
  id: "shared-prefix", command: "printf shared > /home/user/workspace/prefix",
}));
export const snapshotAgent = defineSandboxAgent({
  name: "snapshot-fixture",
  evidenceCoverage: { ...completeEvidenceCoverage, usage: { status: "unavailable", reason: "deterministic fixture" } },
  install: { identity: { agent: "snapshot-fixture", version: "1", revision: "1" }, probe: shell("true") },
  send: async (_input, ctx) => ({ status: "completed", events: [{ type: "message", role: "assistant", text: await ctx.sandbox.readText("prefix") }] }),
});
