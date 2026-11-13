import { defineExperiment } from "niceeval";
import { defineSandboxAgent, completeEvidenceCoverage } from "niceeval/adapter";
import { instaboxSandbox, shell } from "niceeval/sandbox";
import { Effect } from "effect";
export default defineExperiment({
  adapter: defineSandboxAgent({ ensure: { identity: { agent: "transport-fixture", version: "1", revision: "1" }, probe: shell("true") }, name: "transport-fixture", evidenceCoverage: completeEvidenceCoverage, send: async () => ({ status: "completed", events: [] }) }),
  sandbox: instaboxSandbox({ templateId: "universal", lifetimeMs: 600_000 }),
  evals: ["directory"],
});
