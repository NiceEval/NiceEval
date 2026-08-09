import { defineExperiment } from "niceeval";
import { openCodeAgent } from "niceeval/adapter";
import { sandbox } from "../sandbox.ts";

// OpenCode Go 是原生 provider：显式把套餐 API key 交给 Adapter，不配置
// OpenAI-compatible base URL；完整模型 ID 会原样进入 `opencode run --model`。
const agent = openCodeAgent({
  apiKey: process.env.OPENCODE_API_KEY,
});

export default defineExperiment({
  description: "opencode:Go 套餐 API key + DeepSeek V4 Flash 原生 provider 闭环",
  agent,
  model: "opencode-go/deepseek-v4-flash",
  sandbox,
  // provider / credential / model route 是新增覆盖维度，不重复 ci 的完整协议矩阵。
  evals: ["coding-task/write-and-verify"],
  attempts: 1,
});
