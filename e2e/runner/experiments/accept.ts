import { defineExperiment } from "niceeval";
import { definePlugin } from "niceeval/plugin";
import { runnerAgent } from "../agents/live.ts";

const acceptIdentity = definePlugin<{ readonly revision: string }>({
  name: "niceeval.e2e.accept-identity",
  behaviorRevision: "1",
  instanceKey: ({ revision }) => revision,
  experiment: ({ revision }) => ({ identity: { revision }, setup: () => {} }),
});

export default defineExperiment({
  description: "accept and reanchor",
  agent: runnerAgent,
  model: "gpt-5.6-luna",
  evals: ["accept/"],
  plugins: [acceptIdentity({ revision: "stable" })],
});
