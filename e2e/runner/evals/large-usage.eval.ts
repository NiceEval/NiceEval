import { largeUsage } from "../applications/large-usage.ts";
import { equals } from "niceeval/expect";
export default largeUsage.defineEval({
  test(t) {
    t.check(t.value(), equals(42));
  },
});
