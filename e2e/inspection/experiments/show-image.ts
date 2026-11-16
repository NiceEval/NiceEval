import { defineExperiment } from "niceeval";
import { VercelProvider } from "niceeval/judge";
import { imageAdapter } from "../evals/show-image.eval.ts";
export default defineExperiment({
  adapter: imageAdapter,
  evals: ["show-image"],
  judge: VercelProvider({
    model: "fixture-vision",
    baseUrl: process.env.NICEEVAL_E2E_JUDGE_USAGE_URL,
    apiKeyEnv: "NICEEVAL_E2E_IMAGE_KEY",
    supportsImages: true,
    maxOutputTokens: 128,
  }),
});
