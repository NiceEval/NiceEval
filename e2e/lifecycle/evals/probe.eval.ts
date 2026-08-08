import { defineEval } from "niceeval";

export default defineEval({
  description: "next consumer after interrupt",
  async test(t) {
    const turn = await t.send("probe");
    await turn.succeeded().stopOnFailure();
    t.messageIncludes("lifecycle-fixture-ok");
  },
});
