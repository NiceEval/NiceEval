import { OpenAIProvider } from "niceeval/judge";
import { defineJudge } from "niceeval";
import { nativeReuse } from "../applications/native-reuse.ts";

const quality = defineJudge({ name: "reuse-quality", rubric: "The value is 42." });
export default nativeReuse.defineEval({
  judge: OpenAIProvider({
    model: process.env.NICEEVAL_E2E_REUSE_JUDGE_MODEL ?? "first-model",
    baseUrl: process.env.NICEEVAL_E2E_REUSE_JUDGE_URL,
    apiKeyEnv: "NICEEVAL_E2E_REUSE_JUDGE_KEY",
    maxOutputTokens: 128,
  }),
  test(t) { t.check({ value: t.value() }, quality).gate(1); },
});
