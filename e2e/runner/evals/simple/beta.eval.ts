import { defineEval } from "niceeval";

export default defineEval({
  description: "runner carry beta",
  async test(t) {
    const turn = await t.send("beta");
    await turn.succeeded().stopOnFailure();
    t.messageIncludes("runner-fixture-ok");
  },
});
