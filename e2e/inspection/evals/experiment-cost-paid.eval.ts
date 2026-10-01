import { experimentCost } from "../adapters/experiment-cost.ts";

export default experimentCost.defineEval({
  description: "Each paid Attempt reports a precise cost, changed only for the selected rerun",
  test(t) {
    t.recordCost(process.env.NICEEVAL_E2E_EXPERIMENT_COST_PHASE === "replacement" ? "0.300000003" : "0.100000001");
  },
});
