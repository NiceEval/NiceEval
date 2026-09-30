import { defineExperiment } from "niceeval";
import { migrationAgent } from "../agents/migration-agent.ts";

// The Agent shortcut remains a supported input to the common Adapter slot.
export default defineExperiment({
  agent: migrationAgent,
  evals: ["migration-agent"],
  model: "migration-model-agent",
  flags: {
    application: "user-flag-application",
    agentId: "user-flag-agentId",
    nestedApplication: "agentId",
  },
  labels: { migration: "historical-agent", application: "agentId" },
});
