import { experimentCost } from "../adapters/experiment-cost.ts";

export default experimentCost.defineEval({
  description: "A complete application call set can still lack a price",
  test(t) { t.recordCost(undefined); },
});
