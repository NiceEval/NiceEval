import { defineExperiment } from "niceeval";
import { modelSlots } from "../adapters/model-slots.ts";

export default defineExperiment({
  adapter: modelSlots,
  models: { unused: { model: "fixture/unused" }, reviewer: { model: "fixture/shared" }, planner: { model: "fixture/shared", reasoningEffort: "high" } },
  evals: (evaluation) => evaluation.id === "model-slots", attempts: 1,
});
