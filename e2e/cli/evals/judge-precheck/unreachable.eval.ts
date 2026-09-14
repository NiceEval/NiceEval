import { defineEval, defineJudge } from "niceeval";

const judging = defineJudge({ name: "unreachable", rubric: "unreachable" });

export default defineEval({
  description: "Judge endpoint 不可用时保留实际 Assertion 失败",
  async test(t) {
    t.judge("fixture answer", judging).gate(1);
  },
});
