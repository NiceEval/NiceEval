import { equals } from "niceeval/expect";
import { usageSealAdapter } from "../adapters/usage-seal.ts";

export default usageSealAdapter.defineEval({
  description: "Explicitly seal a complete application journal with no requests",
  test(t) {
    t.finishComplete();
    t.check(true, equals(true)).gate();
  },
});
