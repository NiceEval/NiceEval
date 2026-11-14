import { completeEvidenceCoverage, defineAgent, defineSandboxAgent } from "niceeval/adapter";
import { dockerSandbox, shell } from "niceeval/sandbox";
export const lifecycleSandbox = dockerSandbox({
  source: { type: "image", image: "node@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f" },
  user: "node",
  resources: { cpus: 1, memoryBytes: 256 * 1024 ** 2, pidsLimit: 64 },
});
export const quickAgent = defineSandboxAgent({
  name: "agent-review-application",
  evidenceCoverage: {
    ...completeEvidenceCoverage,
    usage: { status: "unavailable", reason: "deterministic fixture has no model usage" },
  },
  ensure: {
    identity: { agent: "review-fixture", version: "1", revision: "1" },
    probe: shell("node --version >/dev/null"),
  },
  send: async (_input, ctx) => {
    await ctx.sandbox.writeText("application.txt", "application evidence");
    await ctx.sandbox.writeText("large.txt", "中".repeat(100_000));
    return { status: "completed", events: [{ type: "message", role: "assistant", text: "application evidence" }] };
  },
});

export const directAgent = defineAgent({
  name: "direct-review-fixture",
  evidenceCoverage: completeEvidenceCoverage,
  send: async () => ({ status: "completed", events: [] }),
});
