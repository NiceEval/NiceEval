import { defineExperiment } from "niceeval";
import { modelSlots } from "../adapters/model-slots.ts";

export default defineExperiment({
  adapter: modelSlots,
  models: { unused: { model: "fixture/unused" }, reviewer: { model: "fixture/unpriced" }, planner: { model: "fixture/shared" } },
  evals: ["model-slots-cost"], attempts: 1,
});
