import { defineEval } from "niceeval";
import { eventMatch, includes } from "niceeval/expect";

export default defineEval({
  description: "runner carry beta",
  async test(t) {
    const turn = await t.send("beta");
    await t.require(turn.succeeded());
    t.assert(
      t.event(
        eventMatch("message", {
          role: "assistant",
          text: includes("runner-fixture-ok"),
        }),
      ),
    );
  },
});
