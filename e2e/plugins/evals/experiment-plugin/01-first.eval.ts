import { defineEval } from "niceeval";

export default defineEval({
  async test(t) {
    const turn = await t.send("verify Experiment Plugin lifecycle for the first Eval");
    await turn.succeeded().orStop();
  },
});
