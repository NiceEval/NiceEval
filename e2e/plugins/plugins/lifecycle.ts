import { Effect } from "effect";
import { definePlugin, defineSandboxResource } from "niceeval/plugin";
import { sandboxLayer, shell } from "niceeval/sandbox";
import { appendPluginLifecycleEvent } from "../fixtures/events.ts";

type ResourceDemand = {
  readonly marker: string;
};

type ResourceHandle = {
  readonly markers: readonly string[];
};

function errorFrom(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

const lifecycleResource = defineSandboxResource<"docker", ResourceDemand, ResourceHandle>({
  receiver: "docker",
  behaviorRevision: "1",
  demand: ({ marker }) => ({ marker }),
  materialize: (demands, context) => Effect.sync(() => {
    const markers = demands.map((demand) => demand.marker);
    appendPluginLifecycleEvent({
      kind: "resource.materialize",
      markers,
      physicalId: context.physicalId,
    });
    return Object.freeze({ markers: Object.freeze(markers) });
  }),
  prepare: (_handle, demand, context) => Effect.gen(function* () {
    appendPluginLifecycleEvent({
      kind: "resource.prepare",
      marker: demand.marker,
      experimentId: context.experimentId,
      evalId: context.evalId,
      attempt: context.attempt,
      physicalId: context.physicalId,
    });
    yield* Effect.tryPromise({
      try: () => context.sandbox.writeText(`/tmp/niceeval-plugin-resource-${demand.marker}`, "ready"),
      catch: errorFrom,
    });
  }),
  release: (handle, context) => Effect.sync(() => {
    appendPluginLifecycleEvent({
      kind: "resource.release",
      markers: handle.markers,
      physicalId: context.physicalId,
    });
  }),
});

export const experimentLifecycle = definePlugin<{ readonly variant: string }>({
  name: "e2e.experiment-lifecycle",
  behaviorRevision: "1",
  instanceKey: ({ variant }) => variant,
  experiment: ({ variant }) => ({
    identity: { variant },
    flags: { pluginScope: "experiment", variant },
    sandbox: sandboxLayer().prepare(
      shell("printf '%s' ready > /tmp/niceeval-experiment-plugin-ready"),
    ),
    setup: (context) => appendPluginLifecycleEvent({
      kind: "experiment.plugin.setup",
      experimentId: context.experimentId,
      selectedEvalIds: context.selectedEvalIds,
    }),
    teardown: (context) => appendPluginLifecycleEvent({
      kind: "experiment.plugin.teardown",
      experimentId: context.experimentId,
      selectedEvalIds: context.selectedEvalIds,
    }),
  }),
});

export const evalLifecycle = definePlugin<{ readonly marker: string }>({
  name: "e2e.eval-lifecycle",
  behaviorRevision: "1",
  instanceKey: ({ marker }) => marker,
  eval: ({ marker }) => ({
    identity: { marker },
    resources: [lifecycleResource({ marker })],
    sandbox: sandboxLayer().prepare(
      shell(
        `test -f /tmp/niceeval-plugin-resource-${marker} && ` +
        `printf '%s' ready > /tmp/niceeval-plugin-command-${marker}`,
      ),
    ),
  }),
});

export const groupIdentity = definePlugin<{ readonly variant: string }>({
  name: "e2e.group-identity",
  behaviorRevision: "1",
  instanceKey: ({ variant }) => variant,
  group: ({ variant }) => ({
    identity: { variant },
    requirements: [{ capability: "shared-physical-sandbox" }],
  }),
});
