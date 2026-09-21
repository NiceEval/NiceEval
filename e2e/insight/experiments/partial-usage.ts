import { defineExperiment } from "niceeval";
import { usageCost } from "../adapters/usage-cost.ts";

export default defineExperiment({
  description: "partial-usage: expose consistent usage and cost subtotals in Insight",
  adapter: usageCost,
  model: "openai/gpt-5.6-luna",
  evals: ["usage-cost"],
});
