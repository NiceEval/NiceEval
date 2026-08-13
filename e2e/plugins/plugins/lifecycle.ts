import { definePlugin } from "niceeval/plugin";
import { appendPluginLifecycleEvent } from "../fixtures/events.ts";

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
  sandbox: ({ marker }) => ({
    identity: { marker },
    setup: (sandbox, context) => appendPluginLifecycleEvent({ kind: "sandbox.plugin.setup", marker, physicalId: sandbox.sandboxId, experimentId: context.experimentId }),
    teardown: (sandbox, context) => appendPluginLifecycleEvent({ kind: "sandbox.plugin.teardown", marker, physicalId: sandbox.sandboxId, experimentId: context.experimentId }),
  }),
  eval: ({ marker }) => ({
    identity: { marker },
    setup: (context) => appendPluginLifecycleEvent({ kind: "eval.plugin.setup", marker, experimentId: context.experimentId, evalId: context.evalId, attempt: context.attempt }),
    teardown: (context) => appendPluginLifecycleEvent({ kind: "eval.plugin.teardown", marker, experimentId: context.experimentId, evalId: context.evalId, attempt: context.attempt }),
  }),
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
