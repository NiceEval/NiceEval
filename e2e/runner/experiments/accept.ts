import { defineExperiment } from "niceeval";
import { definePlugin } from "niceeval/plugin";
import { deterministicAgent } from "../agents/deterministic.ts";

const acceptIdentity = definePlugin(({ revision }: { readonly revision: string }) => ({
  name: "niceeval.e2e.accept-identity",
  key: revision,
  identity: { revision },
  experiment: { before: () => {} },
}));

export default defineExperiment({
  description: "accept and reanchor",
  adapter: deterministicAgent,
  evals: ["accept/"],
  plugins: [acceptIdentity({ revision: "stable" })],
});
