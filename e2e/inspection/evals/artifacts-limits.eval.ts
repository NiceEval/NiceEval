import { equals } from "niceeval/expect";
import { artifactAdapter } from "../adapters/artifacts.ts";

export default artifactAdapter.defineEval({
  async test(t) {
    t.check(await t.rejectOverBudget(), equals(true)).label("invalid attachment is explicitly rejected");
  },
});
