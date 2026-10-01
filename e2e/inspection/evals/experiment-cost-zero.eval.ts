import { experimentCost } from "../adapters/experiment-cost.ts";

export default experimentCost.defineEval({
  description: "A complete application receipt explicitly reports USD zero",
  test(t) { t.recordCost("0"); },
});
