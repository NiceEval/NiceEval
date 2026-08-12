import { defineEval } from "niceeval";
import { evalLifecycle } from "../../plugins/lifecycle.ts";

export default defineEval({
  plugins: [evalLifecycle({ marker: "02-second" })],
  async test(t) {
    const turn = await t.send("verify the second Eval Group Plugin member");
    await turn.succeeded().orStop();
  },
});
