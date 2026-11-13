import { defineExperiment } from "niceeval";
import { defineSandboxAgent, completeEvidenceCoverage } from "niceeval/adapter";
import { instaboxSandbox, shell, uploadDirectory } from "niceeval/sandbox";
import { Effect } from "effect";
export default defineExperiment({
  adapter: defineSandboxAgent({ ensure: { identity: { agent: "transport-fixture", version: "1", revision: "1" }, probe: shell("true") }, name: "transport-fixture", evidenceCoverage: completeEvidenceCoverage, send: async () => ({ status: "completed", events: [] }) }),
  sandbox: instaboxSandbox({ templateId: "universal", lifetimeMs: 600_000 })
    .before(shell("true directory-action-start"))
    .before(uploadDirectory({ id: "directory-action", source: new URL("../fixtures/layer-tree/", import.meta.url), to: "action-target" }))
    .before(shell("true directory-action-end")),
  evals: ["directory"],
});
