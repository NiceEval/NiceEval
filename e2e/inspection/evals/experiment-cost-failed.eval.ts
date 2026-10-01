import { equals } from "niceeval/expect";
import { experimentCost } from "../adapters/experiment-cost.ts";

export default experimentCost.defineEval({
  description: "Failed Attempts retain their sealed reported application charges",
  test(t) {
    t.recordCost("0.200000002", "failed");
    t.check("actual", equals("expected")).gate();
  },
});
