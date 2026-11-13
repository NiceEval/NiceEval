import { defineEval } from "niceeval";
export default defineEval({
  async test(t) {
    await t.send("noop");
    t.sandbox.unchangedWithin(["agents"]).label("zero changes protected");
  },
});
