import { defineExperiment } from "niceeval";
import { definePlugin } from "niceeval/plugin";
import { deterministicAgent } from "../agents/deterministic.ts";

const identity = definePlugin((_options: Record<string, never>) => ({
  name: "niceeval.e2e.dry-structured", key: "stable",
  identity: { aRevision: "before", padding: "x".repeat(700), zRevision: "before" },
  experiment: { before: () => {} },
}));

export default defineExperiment({
  adapter: deterministicAgent,
  evals: ["accept/accept-target"],
  plugins: [identity({})],
  flags: { payload: `{"padding":"${"x".repeat(700)}","revision":"before"}` },
});
