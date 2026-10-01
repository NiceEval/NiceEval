import { defineExperiment } from "niceeval";
import { experimentCost } from "../adapters/experiment-cost.ts";

export default defineExperiment({
  adapter: experimentCost,
  model: "fixture/experiment-cost",
  evals: ["experiment-cost-zero", "experiment-cost-missing"],
  attempts: 1,
});
