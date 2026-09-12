import { defineExperiment } from "niceeval";
import { migrationCustom } from "../adapters/migration-custom.ts";

export default defineExperiment({
  adapter: migrationCustom,
  evals: ["migration-custom"],
  model: "migration-model-custom",
  flags: {
    application: "user-flag-application",
    agentId: "user-flag-agentId",
    nested: { application: "agentId" },
  },
  labels: { migration: "historical-custom", application: "agentId" },
});
