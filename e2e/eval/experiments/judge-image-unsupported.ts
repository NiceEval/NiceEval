import { defineExperiment } from "niceeval";
import { TypesafeProvider } from "niceeval/judge";
import { imageApplication } from "../evals/judge-image.eval.ts";

export default defineExperiment({
  adapter: imageApplication,
  evals: ["judge-image"],
  judgeRuntime: TypesafeProvider({
    model: "fixture-text-only",
    baseUrl: process.env.NICEEVAL_E2E_JUDGE_BASE_URL,
    apiKeyEnv: "NICEEVAL_E2E_ABSENT_IMAGE_KEY",
  }),
});
