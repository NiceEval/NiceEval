import { defineExperiment } from "niceeval";
import { pluginAgent, pluginSandbox } from "../agents/deterministic.ts";
import { appendPluginLifecycleEvent } from "../fixtures/events.ts";
import { lifecycle } from "../plugins/lifecycle.ts";

export default defineExperiment({
  agent: pluginAgent,
  sandbox: pluginSandbox,
  evals: ["experiment-plugin"],
  maxConcurrency: 1,
  plugins: [lifecycle({ marker: "experiment-a" }), lifecycle({ marker: "experiment-b" })],
  setup: (context) => appendPluginLifecycleEvent({
    kind: "experiment.author.setup",
    experimentId: context.experimentId,
  }),
  teardown: (context) => appendPluginLifecycleEvent({
    kind: "experiment.author.teardown",
    experimentId: context.experimentId,
  }),
});
