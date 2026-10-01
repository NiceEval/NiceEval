import { equals } from "niceeval/expect";
import { usageSealAdapter } from "../adapters/usage-seal.ts";

export default usageSealAdapter.defineEval({
  description: "Catching a write after sealing retains the accepted charge and collection failure",
  test(t) {
    t.recordKnownCost();
    t.finishComplete();
    t.check(t.catchWriteAfterSeal(), equals(true)).gate();
  },
});
