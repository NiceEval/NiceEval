import { equals } from "niceeval/expect";
import { executionTraceAdapter } from "../adapters/execution-trace.ts";

export default executionTraceAdapter.defineEval({
  async test(t) {
    t.check(await t.archive(), equals(true)).label("Archive accepted");
  },
});
