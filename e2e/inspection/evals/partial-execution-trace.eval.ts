import { equals } from "niceeval/expect";
import { partialExecutionTraceAdapter } from "../adapters/execution-trace-partial.ts";

export default partialExecutionTraceAdapter.defineEval({
  async test(t) {
    const eventCount = Number(process.env.NICEEVAL_E2E_PARTIAL_TRACE_EVENT_COUNT ?? "0");
    t.check(await t.archive(eventCount), equals(true)).label("Partial archive accepted");
  },
});
