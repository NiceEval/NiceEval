import { OpenAIProvider } from "niceeval/judge";
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
    judge: OpenAIProvider({ model: "eval-specific-model", baseUrl: process.env.NICEEVAL_E2E_JUDGE_BASE_URL, apiKeyEnv: "NICEEVAL_E2E_JUDGE_KEY", maxOutputTokens: 256 }),
    test(t) { t.judge(t.answer(), quality).gate(1); },
  }),
  pure: configurationApplication.defineEval({
    test(t) { t.check(t.answer(), equals("Paris")).gate(); },
  }),
};
