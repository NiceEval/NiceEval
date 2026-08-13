import { defineEval } from "niceeval";
import { evalOnlyLifecycle } from "../../plugins/lifecycle.ts";

export default defineEval({
  plugins: [evalOnlyLifecycle({ marker: "01-first" })],
  async test(t) {
    const turn = await t.send("verify the first Eval Group Plugin member");
    await turn.succeeded().orStop();
  },
});
