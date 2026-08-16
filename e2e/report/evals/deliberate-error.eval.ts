import { defineEval } from "niceeval";

// Deterministically thrown error: the public read face must keep errored distinct
// from failed and JUnit must fold it as <error>.
export default defineEval({
  description: "deliberate-error:已有 usage 后的确定性执行错误(未捕获异常)",

  async test(t) {
    await t.send("report fixture before deliberate error");
    throw new Error("deliberate error for report fixture");
  },
});
