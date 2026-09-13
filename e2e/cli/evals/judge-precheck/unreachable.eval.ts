import { defineEval, defineJudge, judge } from "niceeval";

const judging = defineJudge({
  recipes: [judge.recipes.closedQA],
  material: { criterion: judge.referenceText({ name: "criterion", text: "unreachable" }) },
});

export default defineEval({
  description: "Judge endpoint 预检失败时不应进入 Eval body",
  judge: judging,
  async test() {
    throw new Error("judge precheck fixture unexpectedly reached the Eval body");
  },
});
