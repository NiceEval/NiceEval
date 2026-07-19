import { defineEval } from "niceeval";
import { equals } from "niceeval/expect";

// Deterministically failing assertion — exists solely so this repo can assert the
// `failed` verdict and the JUnit `<failure>` folding (docs/engineering/e2e-ci/report.md
// point 4), distinct from the `errored` case in deliberate-error.eval.ts. No Agent call
// needed: `t.check` on a plain value never depends on evidence coverage, so this fails
// the same way every run.
export default defineEval({
  description: "deterministic failing assertion — verifies the failed verdict and JUnit <failure> folding",

  async test(t) {
    t.check(1 + 1, equals(3));
  },
});
