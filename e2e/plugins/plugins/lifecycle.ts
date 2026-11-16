import Docker from "dockerode";
import { definePlugin } from "niceeval/plugin";
import { changeFrequency, type SandboxCommandContext, writeText, type SandboxCommandTarget } from "niceeval/sandbox";
import {
  appendPluginLifecycleEvent,
  startPluginLifecycleResource,
  stopPluginLifecycleResource,
  waitForPluginTeardown,
} from "../fixtures/events.ts";

const docker = new Docker();

async function currentDockerId(sandbox: SandboxCommandTarget): Promise<string> {
  const inspected = await docker.getContainer(sandbox.sandboxId).inspect();
  const shortId = inspected.Id.slice(0, 12);
  if (sandbox.sandboxId !== shortId) {
    throw new Error(`Sandbox callback ID ${sandbox.sandboxId} did not resolve to Docker container ${shortId}`);
  }
  return shortId;
}

function sandboxFragment(marker: string, declarationKey: string) {
  const markerPath = `/tmp/niceeval-plugin-${declarationKey}.txt`;
  return {
    before: [
      writeText({
        id: `e2e.plugin.${declarationKey}.marker`,
        path: markerPath,
        text: marker,
        changeFrequency: changeFrequency.rare,
      }),
      async (sandbox: SandboxCommandTarget) => {
        const declaredMarker = await sandbox.readText(markerPath);
        appendPluginLifecycleEvent({
          kind: "sandbox.plugin.before",
          marker,
          declaredMarker,
          physicalId: await currentDockerId(sandbox),
        });
      },
    ],
    after: async (sandbox: SandboxCommandTarget, context: Omit<SandboxCommandContext, "onCleanup">) => {
      appendPluginLifecycleEvent({
        kind: "sandbox.plugin.after",
        marker,
        physicalId: await currentDockerId(sandbox),
        ownerKind: context.owner.kind,
        ownerId: context.owner.id,
      });
    },
  };
}

export const lifecycle = definePlugin(({ marker }: { readonly marker: string }) => ({
  name: "e2e.lifecycle",
  key: marker,
  identity: { version: "3", marker },
  experiment: {
    before: (context) =>
      appendPluginLifecycleEvent({ kind: "experiment.plugin.setup", marker, experimentId: context.experimentId }),
    after: (context) =>
      appendPluginLifecycleEvent({ kind: "experiment.plugin.teardown", marker, experimentId: context.experimentId }),
  },
  sandbox: sandboxFragment(marker, `lifecycle.${marker}`),
}));
export const groupLifecycle = definePlugin(({ marker }: { readonly marker: string }) => ({
  name: "e2e.lifecycle",
  key: marker,
  identity: { version: "3", marker },
  group: {
    before: (context) =>
      appendPluginLifecycleEvent({
        kind: "group.plugin.setup",
        marker,
        experimentId: context.experimentId,
        evalGroupId: context.evalGroupId,
      }),
    after: (context) =>
      appendPluginLifecycleEvent({
        kind: "group.plugin.teardown",
        marker,
        experimentId: context.experimentId,
        evalGroupId: context.evalGroupId,
      }),
  },
  sandbox: sandboxFragment(marker, `lifecycle.${marker}`),
}));
export const evalLifecycle = definePlugin(({ marker }: { readonly marker: string }) => ({
  name: "e2e.lifecycle",
  key: marker,
  identity: { version: "3", marker },
  attempt: {
    before: (context) =>
      appendPluginLifecycleEvent({
        kind: "eval.plugin.setup",
        marker,
        experimentId: context.experimentId,
        evalId: context.evalId,
        attempt: context.attempt,
      }),
    after: (context) =>
      appendPluginLifecycleEvent({
        kind: "eval.plugin.teardown",
        marker,
        experimentId: context.experimentId,
        evalId: context.evalId,
        attempt: context.attempt,
      }),
  },
  sandbox: sandboxFragment(marker, `lifecycle.${marker}`),
}));
export const sandboxOnlyToolchain = definePlugin(({ marker }: { readonly marker: string }) => ({
  name: "e2e.sandbox-only-toolchain",
  identity: { version: "2" },
  sandbox: {
    ...sandboxFragment("stable", "toolchain"),
    after: [sandboxFragment("stable", "toolchain").after, ...(marker === "stable" ? [] : [async () => {}])],
  },
}));
export const defaultEvalLifecycle = definePlugin({
  name: "e2e.default-eval-lifecycle",
  identity: { version: "2" },
  attempt: {
    before: (context) =>
      appendPluginLifecycleEvent({
        kind: "eval.plugin.setup",
        marker: "default",
        evalId: context.evalId,
        attempt: context.attempt,
      }),
    after: (context) =>
      appendPluginLifecycleEvent({
        kind: "eval.plugin.teardown",
        marker: "default",
        evalId: context.evalId,
        attempt: context.attempt,
      }),
  },
});
export const evalOnlyLifecycle = definePlugin(({ marker }: { readonly marker: string }) => ({
  name: "e2e.eval-only-lifecycle",
  key: marker,
  identity: { version: "2", marker },
  attempt: {
    before: (context) =>
      appendPluginLifecycleEvent({
        kind: "eval.plugin.setup",
        marker,
        evalId: context.evalId,
        attempt: context.attempt,
      }),
    after: (context) =>
      appendPluginLifecycleEvent({
        kind: "eval.plugin.teardown",
        marker,
        evalId: context.evalId,
        attempt: context.attempt,
      }),
  },
}));

const interruptResources = new Map<string, ReturnType<typeof startPluginLifecycleResource>>();

export const interruptEvalLifecycle = definePlugin({
  name: "e2e.interrupt-eval-lifecycle",
  identity: { version: "2" },
  attempt: {
    before: (context) => {
      const key = `${context.experimentId}:${context.evalId}:${context.attempt}`;
      const child = startPluginLifecycleResource();
      if (child.pid === undefined) throw new Error("Eval Plugin did not start its managed resource.");
      interruptResources.set(key, child);
      appendPluginLifecycleEvent({
        kind: "eval.plugin.interrupt.setup",
        resourcePid: child.pid,
        signalAborted: context.signal.aborted,
      });
    },
    after: async (context) => {
      const key = `${context.experimentId}:${context.evalId}:${context.attempt}`;
      const child = interruptResources.get(key);
      appendPluginLifecycleEvent({
        kind: "eval.plugin.interrupt.teardown.started",
        signalAborted: context.signal.aborted,
      });
      if (child === undefined) throw new Error("Eval Plugin lost its managed resource.");
      await stopPluginLifecycleResource(child);
      interruptResources.delete(key);
      await waitForPluginTeardown(context.signal);
      appendPluginLifecycleEvent({
        kind: "eval.plugin.interrupt.teardown.completed",
        resourcePid: child.pid,
      });
    },
  },
});
