import { defineEval } from "niceeval";
import { evalOnlyLifecycle } from "../../plugins/lifecycle.ts";

export default defineEval({
  plugins: [evalOnlyLifecycle({ marker: "02-second" })],
  async test(t) {
    const turn = await t.send("verify the second Eval Group Plugin member");
    await turn.succeeded().orStop();
  },
});
