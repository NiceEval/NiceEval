import { defineExperiment } from "niceeval";
import { definePlugin } from "niceeval/plugin";
import { deterministicAgent } from "../agents/deterministic.ts";

const acceptIdentity = definePlugin<{ readonly revision: string }>({
  name: "niceeval.e2e.accept-identity",
  behaviorRevision: "1",
  instanceKey: ({ revision }) => revision,
  experiment: ({ revision }) => ({ identity: { revision } }),
});

export default defineExperiment({
  description: "accept and reanchor",
  agent: deterministicAgent,
  evals: ["accept/"],
  plugins: [acceptIdentity({ revision: "stable" })],
});
