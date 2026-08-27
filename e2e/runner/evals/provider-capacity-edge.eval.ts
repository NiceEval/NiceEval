import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "a profile reservation runs only after exact granted admission",
  async test(t) {
    const turn = await t.send("run the provider-capacity edge Attempt");
    await turn.succeeded().orStop();
    t.check(turn.message, includes("provider-capacity-fixture-ok"));
  },
});
