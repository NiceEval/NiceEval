import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "runner max concurrency independent probe",
  async test(t) {
    const turn = await t.send("probe");
    await turn.succeeded().orStop();
    t.check(turn.message, includes("max-concurrency-fixture-ok"));
  },
});
