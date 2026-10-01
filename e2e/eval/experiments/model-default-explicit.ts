import { defineExperiment } from "niceeval";
import { modelSlots } from "../fixtures/model-slots.ts";

export default defineExperiment({ adapter: modelSlots, models: { default: { model: "fixture/default", reasoningEffort: "high" } }, evals: ["model-slot-selection"], attempts: 1 });
