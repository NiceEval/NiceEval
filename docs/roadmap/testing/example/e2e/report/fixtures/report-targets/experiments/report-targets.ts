import { defineExperiment } from "niceeval";
import { failedEval } from "../evals/failed.eval";

export default defineExperiment({
  id: "report-targets",
  evals: [failedEval],
  adapter: "deliberate",
  attempts: 1,
});
