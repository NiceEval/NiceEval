import { defineExperiment } from "niceeval";
import { roles } from "../fixtures/model-roles.ts";

export default defineExperiment({
  adapter: roles,
  model: "fixture/default",
  reasoningEffort: "high",
  evals: ["model-role-selection"],
  attempts: 1,
});
