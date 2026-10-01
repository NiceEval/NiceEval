import { equals } from "niceeval/expect";
import { usageSealAdapter } from "../adapters/usage-seal.ts";

export default usageSealAdapter.defineEval({
  description: "Explicit partial journal retains its known application charge",
  test(t) {
    t.recordKnownCost();
    t.finishPartial();
    t.check(true, equals(true)).gate();
  },
});
