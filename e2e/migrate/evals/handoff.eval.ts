import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "Persist one deterministic result for the replaceable producer/consumer handoff",
  async test(t) {
    const turn = await t.send("handoff-input");
    await turn.succeeded().orStop();
    t.check(turn.message, includes("persisted-handoff:handoff-input"));
  },
});
