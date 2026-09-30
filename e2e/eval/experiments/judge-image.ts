import { defineExperiment } from "niceeval";
import { VercelProvider } from "niceeval/judge";
import { imageApplication } from "../evals/judge-image.eval.ts";

export default defineExperiment({
  adapter: imageApplication,
  evals: ["judge-image"],
  judgeRuntime: VercelProvider({
    model: "fixture-vision",
    baseUrl: process.env.NICEEVAL_E2E_JUDGE_BASE_URL,
    apiKeyEnv: "NICEEVAL_E2E_JUDGE_KEY",
    supportsImages: true,
    maxOutputTokens: 128,
  }),
});
