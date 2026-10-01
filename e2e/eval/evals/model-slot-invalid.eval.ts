import { equals } from "niceeval/expect";
import { modelSlots } from "../fixtures/model-slots.ts";

export default modelSlots.defineEval({
  description: "Catching a bad usage reference cannot erase the collection failure",
  test(t) {
    t.record({ callId: "accepted", modelSlot: "planner", provider: null, model: "fixture/actual", status: "succeeded", inputTokens: 1, outputTokens: 1 });
    t.check(t.catchInvalidReference(), equals(true)).gate();
  },
});
