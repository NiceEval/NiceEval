import { defineExperiment } from "niceeval";
import { modelSlots } from "../adapters/model-slots.ts";

export default defineExperiment({
  adapter: modelSlots,
  models: { z: { model: "fixture/z" }, unused: { model: "fixture/unused" }, a: { model: "fixture/requested-a" } },
  evals: ["model-slots-truncated"], attempts: 1,
});
