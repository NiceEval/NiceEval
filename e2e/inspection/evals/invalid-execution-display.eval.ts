import { equals } from "niceeval/expect";
import { executionDisplayAdapter } from "../adapters/execution-display.ts";

export default executionDisplayAdapter.defineEval({
  async test(t) {
    t.check(await t.rejectInvalid(), equals(true)).label("Invalid display rejected");
  },
});
