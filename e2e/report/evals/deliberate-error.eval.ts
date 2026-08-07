import { defineEval } from "niceeval";

// Deterministically thrown error: the public read face must keep errored distinct
// from failed and JUnit must fold it as <error>.
export default defineEval({
  description: "deliberate-error:确定性执行错误(未捕获异常)",

  async test() {
    throw new Error("deliberate error for report fixture");
  },
});
