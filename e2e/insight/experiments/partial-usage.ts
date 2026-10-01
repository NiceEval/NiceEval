import { defineExperiment } from "niceeval";
import { usageCost } from "../adapters/usage-cost.ts";

export default defineExperiment({
  description: "partial-usage: expose consistent usage and cost subtotals in Insight",
  adapter: usageCost,
  models: {
    primary: { model: "typesafe-ai/requested" },
    secondary: { model: "openai/gpt-6-luna" },
    unused: { model: "typesafe-ai/unused" },
  },
  evals: ["usage-cost"],
});
