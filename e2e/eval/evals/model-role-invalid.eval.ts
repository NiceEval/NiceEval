import { equals } from "niceeval/expect";
import { roles } from "../fixtures/model-roles.ts";

export default roles.defineEval({
  description: "Catching a bad usage reference cannot erase the collection failure",
  test(t) {
    t.record({
      callId: "accepted",
      modelRole: "planner",
      provider: null,
      model: "fixture/actual",
      status: "succeeded",
      inputTokens: 1,
      outputTokens: 1,
    });
    t.check(t.catchInvalidReference(), equals(true)).gate();
  },
});
