import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "deterministic passing result",
  async test(t) {
    await t.send("reply with the fixture value");
    t.check(t.reply, includes("fixture-ready"));
  },
});
