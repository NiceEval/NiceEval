import { defineExperiment } from "niceeval";
import { modelSlots } from "../fixtures/model-slots.ts";

export default defineExperiment({ adapter: modelSlots, evals: ["model-slot-selection"], attempts: 1 });
