import { includes } from "niceeval/expect";
import { usageSealAdapter } from "../adapters/usage-seal.ts";

export default usageSealAdapter.defineEval({
  test(t) {
    t.recordKnownCost();
    t.check(t.catchInvalidReason(), includes("sealUsage partial reason must be 1-128 ASCII characters")).label(
      "actionable reason error at the call site",
    );
  },
});
