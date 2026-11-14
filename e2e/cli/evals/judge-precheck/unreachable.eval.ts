import { defineEval } from "niceeval";
import { defineJudge } from "niceeval/expect";

const judging = defineJudge({ rubric: "unreachable" });

export default defineEval({
  description: "Judge endpoint 不可用时保留实际 Assertion 失败",
  async test(t) {
    t.judge("fixture answer", judging).gate(1);
  },
});
