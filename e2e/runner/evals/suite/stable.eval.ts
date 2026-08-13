import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "runner history stable",
  async test(t) {
    const turn = await t.send("history");
    await turn.succeeded().orStop();
    t.check(turn.message, includes("runner-live-ok"));
  },
});
