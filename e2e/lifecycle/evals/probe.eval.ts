import { defineEval } from "niceeval";
import { eventMatch, includes } from "niceeval/expect";

export default defineEval({
  description: "next consumer after interrupt",
  async test(t) {
    const turn = await t.send("probe");
    await t.require(turn.succeeded());
    t.assert(
      t.event(
        eventMatch("message", {
          role: "assistant",
          text: includes("lifecycle-fixture-ok"),
        }),
      ),
    );
  },
});
