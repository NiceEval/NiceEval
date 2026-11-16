import { defineExperiment } from "niceeval";
import { roles } from "../adapters/model-roles.ts";

export default defineExperiment({
  adapter: roles,
  models: {
    unused: { model: "fixture/unused" },
    reviewer: { model: "fixture/shared" },
    planner: { model: "fixture/shared", reasoningEffort: "high" },
  },
  evals: (evaluation) => evaluation.id === "model-roles",
  attempts: 1,
});
