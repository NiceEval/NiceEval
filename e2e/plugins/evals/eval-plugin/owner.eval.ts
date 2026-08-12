import { defineEval } from "niceeval";
import { evalLifecycle } from "../../plugins/lifecycle.ts";

export default defineEval({
  plugins: [evalLifecycle({ marker: "owner" })],
  async test(t) {
    const turn = await t.send("verify Eval Plugin resource lifecycle");
    await turn.succeeded().stopOnFailure();
    t.messageIncludes("eval-plugin:eval-plugin/owner:plugin-ready");
  },
});
