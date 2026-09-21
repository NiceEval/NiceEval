import { equals } from "niceeval/expect";
import { executionTrace } from "../adapters/execution-trace.ts";

export default executionTrace.defineEval({
  async test(t) { t.check(await t.archive(), equals(true)); },
});
