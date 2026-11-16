import { defineExperiment } from "niceeval";
import { roles } from "../adapters/model-roles.ts";

export default defineExperiment({
  adapter: roles,
  models: {
    unused: { model: "fixture/unused" },
    reviewer: { model: "fixture/unpriced" },
    planner: { model: "fixture/shared" },
  },
  evals: ["model-roles-cost"],
  attempts: 1,
});
