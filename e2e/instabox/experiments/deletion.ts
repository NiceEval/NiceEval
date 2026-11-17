import { defineExperiment } from "niceeval";
import { defineSandboxAgent, completeEvidenceCoverage } from "niceeval/adapter";
import { instaboxSandbox, shell } from "niceeval/sandbox";

export default defineExperiment({
  adapter: defineSandboxAgent({
    name: "deletion-fixture",
    ensure: { identity: { agent: "shell", version: "1", revision: "1" }, probe: shell("true") },
    evidenceCoverage: completeEvidenceCoverage,
    send: async () => ({ status: "completed", events: [] }),
  }),
  sandbox: instaboxSandbox({ templateId: "universal", lifetimeMs: 600_000 }),
  evals: ["deletion"],
});
