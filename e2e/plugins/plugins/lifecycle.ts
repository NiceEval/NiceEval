import Docker from "dockerode";
import { definePlugin } from "niceeval/plugin";
import {
  changeFrequency,
  sandboxLayer,
  writeText,
  type SandboxCommandTarget,
} from "niceeval/sandbox";
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
  return sandboxLayer()
    .before(writeText({
      id: `e2e.plugin.${declarationKey}.marker`,
      path: markerPath,
      text: marker,
      changeFrequency: changeFrequency.rare,
    }))
    .before(async (sandbox: SandboxCommandTarget) => {
      const declaredMarker = await sandbox.readText(markerPath);
      appendPluginLifecycleEvent({
        kind: "sandbox.plugin.before",
        marker,
        declaredMarker,
        physicalId: await currentDockerId(sandbox),
      });
    })
    .after(async (sandbox, context) => {
      appendPluginLifecycleEvent({
        kind: "sandbox.plugin.after",
        marker,
        physicalId: await currentDockerId(sandbox),
        ownerKind: context.owner.kind,
        ownerId: context.owner.id,
      });
    });
}

export const lifecycle = definePlugin<{ readonly marker: string }>({
  name: "e2e.lifecycle",
  behaviorRevision: "2",
  instanceKey: ({ marker }) => marker,
  experiment: ({ marker }) => ({
    identity: { marker },
    setup: (context) => appendPluginLifecycleEvent({ kind: "experiment.plugin.setup", marker, experimentId: context.experimentId }),
    teardown: (context) => appendPluginLifecycleEvent({ kind: "experiment.plugin.teardown", marker, experimentId: context.experimentId }),
  }),
  group: ({ marker }) => ({
    identity: { marker },
    setup: (context) => appendPluginLifecycleEvent({ kind: "group.plugin.setup", marker, experimentId: context.experimentId, evalGroupId: context.evalGroupId }),
    teardown: (context) => appendPluginLifecycleEvent({ kind: "group.plugin.teardown", marker, experimentId: context.experimentId, evalGroupId: context.evalGroupId }),
  }),
  sandbox: ({ marker }) => sandboxFragment(marker, `lifecycle.${marker}`),
  eval: ({ marker }) => ({
    identity: { marker },
    setup: (context) => appendPluginLifecycleEvent({ kind: "eval.plugin.setup", marker, experimentId: context.experimentId, evalId: context.evalId, attempt: context.attempt }),
    teardown: (context) => appendPluginLifecycleEvent({ kind: "eval.plugin.teardown", marker, experimentId: context.experimentId, evalId: context.evalId, attempt: context.attempt }),
  }),
});

/** A pure toolchain Plugin has no host callback and can attach to every host owner. */
export const sandboxOnlyToolchain = definePlugin<{ readonly marker: string }>({
  name: "e2e.sandbox-only-toolchain",
  behaviorRevision: "1",
  instanceKey: () => "default",
  sandbox: ({ marker }) => {
    const fragment = sandboxFragment("stable", "toolchain");
    return marker === "stable" ? fragment : fragment.after(async () => {});
  },
});

/** Proves the no-option family sugar: its stable instance key is `default`. */
export const defaultEvalLifecycle = definePlugin({
  name: "e2e.default-eval-lifecycle",
  behaviorRevision: "1",
  eval: () => ({
    setup: (context) => appendPluginLifecycleEvent({ kind: "eval.plugin.setup", marker: "default", evalId: context.evalId, attempt: context.attempt }),
    teardown: (context) => appendPluginLifecycleEvent({ kind: "eval.plugin.teardown", marker: "default", evalId: context.evalId, attempt: context.attempt }),
  }),
});

export const evalOnlyLifecycle = definePlugin<{ readonly marker: string }>({
  name: "e2e.eval-only-lifecycle",
  behaviorRevision: "1",
  instanceKey: ({ marker }) => marker,
  eval: ({ marker }) => ({
    identity: { marker },
    setup: (context) => appendPluginLifecycleEvent({ kind: "eval.plugin.setup", marker, evalId: context.evalId, attempt: context.attempt }),
    teardown: (context) => appendPluginLifecycleEvent({ kind: "eval.plugin.teardown", marker, evalId: context.evalId, attempt: context.attempt }),
  }),
});

const interruptResources = new Map<string, ReturnType<typeof startPluginLifecycleResource>>();

export const interruptEvalLifecycle = definePlugin({
  name: "e2e.interrupt-eval-lifecycle",
  behaviorRevision: "1",
  eval: () => ({
    setup: (context) => {
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
    teardown: async (context) => {
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
  }),
});
