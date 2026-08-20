import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "runner max concurrency holding gamma",
  async test(t) {
    const turn = await t.send("hold gamma");
    await turn.succeeded().orStop();
    t.check(turn.message, includes("max-concurrency-fixture-ok"));
  },
});
