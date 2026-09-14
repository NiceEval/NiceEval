import { defineAdapter, defineJudge } from "niceeval";
import { equals } from "niceeval/expect";

export const configurationApplication = defineAdapter({
  name: "judge-configuration",
  behaviorRevision: "1",
  create: () => ({ answer: () => "Paris" }),
});
const quality = defineJudge({ name: "configuration-quality", rubric: "The answer names Paris." });

export default {
  inherited: configurationApplication.defineEval({
    test(t) { t.check(t.answer(), quality).gate(1); },
  }),
  overridden: configurationApplication.defineEval({
    judge: { model: "eval-specific-model", maxOutputTokens: 256 },
    test(t) { t.judge(t.answer(), quality).gate(1); },
  }),
  pure: configurationApplication.defineEval({
    test(t) { t.check(t.answer(), equals("Paris")).gate(); },
  }),
};
