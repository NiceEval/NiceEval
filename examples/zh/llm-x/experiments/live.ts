import { defineExperiment } from "niceeval";
import { OpenAIProvider } from "niceeval/judge";
import { x } from "../evaluation/adapter.js";

const judgeModel = process.env.OPENAI_JUDGE_MODEL ?? process.env.OPENAI_MODEL;

export default defineExperiment({
  description: "真实后端与模型生成社交内容，由文本 Judge 按显式 rubric 评分；不代表图片质量",
  adapter: x,
  ...(process.env.OPENAI_MODEL ? { model: process.env.OPENAI_MODEL } : {}),
  flags: {
    provider: "live",
    apiBase: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    imageModel: process.env.OPENAI_IMAGE_MODEL ?? "",
    requestTimeoutMs: 300_000,
    replyTimeoutMs: 180_000,
  },
  ...(judgeModel
    ? {
        judgeRuntime: OpenAIProvider({
          model: judgeModel,
          baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
        }),
      }
    : {}),
  timeoutMs: 900_000,
  attempts: 1,
  evals: ["content-quality"],
});
