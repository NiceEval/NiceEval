import { defineEval } from "niceeval";

export default defineEval({
  description: "runner carry alpha",
  async test(t) {
    const turn = await t.send("alpha");
    await turn.succeeded().stopOnFailure();
    t.messageIncludes("runner-fixture-ok");
  },
});
