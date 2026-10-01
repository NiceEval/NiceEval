import { equals } from "niceeval/expect";
import { executionDisplayAdapter } from "../adapters/execution-display.ts";

export default executionDisplayAdapter.defineEval({
  async test(t) {
    t.check(await t.archive(), equals(true)).label("Application display archived");
  },
});
