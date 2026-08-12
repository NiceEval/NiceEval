import { defineEval } from "niceeval";

export default defineEval({
  async test(t) {
    const turn = await t.send("verify Experiment Plugin lifecycle for the second Eval");
    await turn.succeeded().stopOnFailure();
    t.messageIncludes("experiment-plugin:experiment-plugin/02-second:plugin-ready");
  },
});
