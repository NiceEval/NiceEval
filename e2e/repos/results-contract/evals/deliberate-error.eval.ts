import { defineEval } from "niceeval";

// Deterministically thrown error — exists solely so this repo can assert the `errored`
// verdict and the JUnit `<error>` folding, kept distinct from the `failed` case in
// deliberate-fail.eval.ts (docs/engineering/e2e-ci/report.md point 4). Throwing inside
// test() is an eval-script exception — a framework/environment-level fault, not an
// assertion outcome — so the runner records it as `errored`, never `failed`.
export default defineEval({
  description: "deterministic thrown error — verifies the errored verdict and JUnit <error> folding",

  async test() {
    throw new Error("deliberate error for e2e contract testing");
  },
});
