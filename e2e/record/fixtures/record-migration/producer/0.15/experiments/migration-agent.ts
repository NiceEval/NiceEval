import { defineExperiment } from "niceeval";
import { migrationAgent } from "../agents/migration-agent.ts";

export default defineExperiment({
  agent: migrationAgent,
  evals: ["migration-agent"],
  model: "migration-model-agent",
  flags: {
    application: "user-flag-application",
    agentId: "user-flag-agentId",
    nested: { application: "agentId" },
  },
  labels: { migration: "historical-agent", application: "agentId" },
});
