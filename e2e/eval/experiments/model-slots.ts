import { defineExperiment } from "niceeval";
import { modelSlots } from "../fixtures/model-slots.ts";

export default defineExperiment({
  adapter: modelSlots,
  models: {
    unused: { model: "fixture/unused" },
    reviewer: { model: "fixture/shared" },
    planner: { model: "fixture/shared", reasoningEffort: "high" },
  },
  evals: ["model-slot-selection", "model-slot-invalid"],
  attempts: 1,
});
