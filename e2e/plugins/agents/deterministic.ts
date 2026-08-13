import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
import { dockerSandbox, shell } from "niceeval/sandbox";
import { appendPluginLifecycleEvent } from "../fixtures/events.ts";

const evidenceCoverage = {
  ...completeEvidenceCoverage,
  usage: { status: "unavailable", reason: "deterministic Plugin fixture has no token usage" } as const,
};

const NODE_IMAGE = "node@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f";

export const pluginSandbox = dockerSandbox({
  source: { type: "image", image: NODE_IMAGE },
  user: "node",
  lifetimeMs: 5 * 60_000,
  resources: {
    cpus: 1,
    memoryBytes: 512 * 1024 ** 2,
    pidsLimit: 128,
  },
});

const ensure = {
  identity: { agent: "plugin-lifecycle-fixture", version: "24.19.0", revision: "1" },
  probe: shell('test "$(node --version)" = "v24.19.0"'),
};

export const pluginAgent = defineSandboxAgent({
  name: "plugin-lifecycle-fixture",
  evidenceCoverage,
  ensure,
  async send(_input, ctx) {
    const experimentId = ctx.experimentId;
    const evalId = ctx.evalId;
    if (experimentId === undefined || evalId === undefined || ctx.attempt === undefined) {
      throw new Error("Plugin fixture requires an Experiment, Eval, and Attempt identity.");
    }

    appendPluginLifecycleEvent({
      kind: "agent.send",
      experimentId,
      evalId,
      attempt: ctx.attempt.index,
      ...(ctx.evalGroup === undefined ? {} : { evalGroupId: ctx.evalGroup.id }),
    });
    return {
      status: "completed",
      events: [{ type: "message", role: "assistant", text: `${experimentId}:${evalId}:plugin-ready` }],
    };
  },
});
