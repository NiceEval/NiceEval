import { equals } from "niceeval/expect";
import { successfulSlowCleanup } from "../fixtures/custom-applications.ts";

export default successfulSlowCleanup.defineEval({
  test(t) { t.check(t.value(), equals(42)); },
});
