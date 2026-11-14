import { defineExperiment } from "niceeval";
import { roles } from "../adapters/model-roles.ts";

export default defineExperiment({
  adapter: roles,
  models: { z: { model: "fixture/z" }, unused: { model: "fixture/unused" }, a: { model: "fixture/requested-a" } },
  evals: ["model-roles-truncated"],
  attempts: 1,
});
