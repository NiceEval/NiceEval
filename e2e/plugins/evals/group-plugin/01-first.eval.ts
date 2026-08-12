import { defineEval } from "niceeval";
import { evalLifecycle } from "../../plugins/lifecycle.ts";

export default defineEval({
  plugins: [evalLifecycle({ marker: "01-first" })],
  async test(t) {
    const turn = await t.send("verify the first Eval Group Plugin member");
    await turn.succeeded().stopOnFailure();
    t.messageIncludes("group-plugin:group-plugin/01-first:plugin-ready");
  },
});
