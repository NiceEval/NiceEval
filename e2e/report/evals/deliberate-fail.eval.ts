import { defineEval } from "niceeval";
import { equals } from "niceeval/expect";

// Deterministically failing assertion: the public read face must keep failed distinct
// from errored and JUnit must fold it as <failure>.
export default defineEval({
  description: "deliberate-fail:确定性失败断言",

  async test(t) {
    t.check(1 + 1, equals(3));
  },
});
