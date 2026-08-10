import { defineEval } from "niceeval";

export default defineEval({
  description: "runner accept reanchor target",
  async test(t) {
    const turn = await t.send("accept");
    await turn.succeeded().stopOnFailure();
    t.messageIncludes("runner-fixture-ok");
  },
});
