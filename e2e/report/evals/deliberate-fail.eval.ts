import { defineEval } from "niceeval";
import { equals } from "niceeval/expect";

// Deterministically failing assertion — exists solely so this repo can assert the
// `failed` verdict and the JUnit `<failure>` folding (docs/engineering/testing/e2e/report.md
// point 4), distinct from the `errored` case in deliberate-error.eval.ts. No Agent call
// needed: `t.check` on a plain value never depends on evidence coverage, so this fails
// the same way on every attempt.
export default defineEval({
  description: "deliberate-fail:确定性失败断言,验证 failed 判定与 JUnit <failure> 折叠",

  async test(t) {
    t.check(1 + 1, equals(3));
  },
});
