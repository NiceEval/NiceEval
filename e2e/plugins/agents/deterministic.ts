import { completeEvidenceCoverage, defineAgent, defineSandboxAgent } from "niceeval/adapter";
import { dockerSandbox, shell } from "niceeval/sandbox";
import {
  appendPluginLifecycleEvent,
  startPluginLifecycleResource,
  stopPluginLifecycleResource,
  waitForPluginTeardown,
} from "../fixtures/events.ts";

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
  send: async (_input, ctx) => {
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

export const pluginDirectAgent = defineAgent({
  name: "plugin-lifecycle-direct-fixture",
  evidenceCoverage,
  setup: (context) => {
    const attemptId = context.attempt?.id;
    if (attemptId === undefined) throw new Error("Plugin Direct Agent requires an Attempt identity.");
    const child = startPluginLifecycleResource();
    if (child.pid === undefined) throw new Error("Plugin Direct Agent did not start its managed resource.");
    directAgentResources.set(attemptId, child);
    appendPluginLifecycleEvent({
      kind: "direct.agent.setup",
      attemptId,
      resourcePid: child.pid,
      signalAborted: context.signal.aborted,
    });
  },
  send: async (_input, context) => {
    appendPluginLifecycleEvent({ kind: "direct.agent.send", attemptId: context.attempt?.id });
    return {
      status: "completed",
      events: [{ type: "message", role: "assistant", text: "plugin interrupt fixture ready" }],
    };
  },
  teardown: async (context) => {
    const attemptId = context.attempt?.id;
    if (attemptId === undefined) throw new Error("Plugin Direct Agent requires an Attempt identity.");
    const child = directAgentResources.get(attemptId);
    appendPluginLifecycleEvent({
      kind: "direct.agent.teardown.started",
      attemptId,
      signalAborted: context.signal.aborted,
    });
    if (child === undefined) throw new Error("Plugin Direct Agent lost its managed resource.");
    await stopPluginLifecycleResource(child);
    directAgentResources.delete(attemptId);
    if (context.flags.slowTeardown === true) await waitForPluginTeardown(context.signal);
    appendPluginLifecycleEvent({
      kind: "direct.agent.teardown.completed",
      attemptId,
      resourcePid: child.pid,
    });
  },
});

const directAgentResources = new Map<string, ReturnType<typeof startPluginLifecycleResource>>();
