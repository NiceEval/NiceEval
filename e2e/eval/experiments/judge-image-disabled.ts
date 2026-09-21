import { defineExperiment } from "niceeval";
import { OpenAIProvider } from "niceeval/judge";
import { imageApplication } from "../evals/judge-image.eval.ts";

export default defineExperiment({
  adapter: imageApplication,
  evals: ["judge-image"],
  judgeRuntime: OpenAIProvider({
    model: "fixture-image-not-enabled",
    baseUrl: process.env.NICEEVAL_E2E_JUDGE_BASE_URL,
    apiKeyEnv: "NICEEVAL_E2E_ABSENT_IMAGE_KEY",
  }),
});
