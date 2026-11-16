import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";
export default defineEval({
  async test(t) {
    const turn = await t.send("read shared prefix");
    await turn.succeeded().orStop();
    t.check(turn.reply, includes("shared"));
  },
});
