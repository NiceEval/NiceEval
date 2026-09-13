import { defineExperiment } from "niceeval";
import { judgePresetApplication } from "../evals/assertion-judge-presets.eval.ts";

export default defineExperiment({
  description: "Read the score and model steps for a combined rubric",
  adapter: judgePresetApplication,
  evals: ["assertion-judge-presets"],
});
