import { defineEval } from "niceeval";
import { defaultEvalLifecycle, lifecycle } from "../../plugins/lifecycle.ts";

export default defineEval({
  plugins: [defaultEvalLifecycle(), lifecycle({ marker: "owner-a" }), lifecycle({ marker: "owner-b" })],
  async test(t) {
    const turn = await t.send("verify multiple Eval Plugin lifecycles");
    await turn.succeeded().orStop();
  },
});
