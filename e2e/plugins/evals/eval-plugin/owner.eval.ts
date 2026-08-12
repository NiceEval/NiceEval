import { defineEval } from "niceeval";
import { defaultEvalIdentity, evalLifecycle } from "../../plugins/lifecycle.ts";

export default defineEval({
  plugins: [defaultEvalIdentity(), evalLifecycle({ marker: "owner" })],
  async test(t) {
    const turn = await t.send("verify Eval Plugin resource lifecycle");
    await turn.succeeded().orStop();
  },
});
