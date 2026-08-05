import { defineExperiment } from "niceeval";
import { aiSdkAgent } from "niceeval/adapter";
import { generateText, stepCountIs, type ModelMessage } from "ai";
import { resolveModel } from "../src/model.ts";
import { weatherTools } from "../src/tools.ts";

const agent = aiSdkAgent<ModelMessage>({
  name: "cli-mechanism",
  generate: ({ messages, model, signal }) =>
    generateText({
      model: resolveModel(model ?? "gpt-5.6-luna"),
      messages,
      tools: weatherTools(),
      stopWhen: stepCountIs(3),
      abortSignal: signal,
    }),
});

// 正常路径:两条正例(greet/、tool/ 两个 id 前缀),断言按 Eval 级折叠后整体退出 0。
// 同时是缓存三步验收的基线实验——scripts/verify.ts 对它先 --rerun all 再不带 --rerun all 再 --rerun all。
export default defineExperiment({
  description: "normal:真实 Chat Completions 网关,问候 + 工具调用两条正例",
  agent,
  model: "gpt-5.6-luna",
  evals: ["greet", "tool"],
});
