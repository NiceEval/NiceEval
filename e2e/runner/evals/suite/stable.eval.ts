import { defineEval } from "niceeval";

export default defineEval({
  description: "runner history stable",
  async test(t) {
    const turn = await t.send("history");
    await turn.succeeded().stopOnFailure();
    t.messageIncludes("runner-fixture-ok");
  },
});
