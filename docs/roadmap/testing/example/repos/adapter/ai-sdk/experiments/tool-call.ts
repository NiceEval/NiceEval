// 单一实验：仓库全部 Eval 共用同一个 uiMessageStreamAgent。agent 走真实适配器公开
// 边界——只 fetch 被测应用的 HTTP 端点，不 import 应用代码。
import { defineExperiment } from "niceeval";
import { uiMessageStreamAgent } from "niceeval/adapter";
import { DEFAULT_MODEL } from "../src/backend/models.ts";

const BASE_URL = process.env.AI_SDK_URL ?? "http://127.0.0.1:34101";

export default defineExperiment({
  description: "ai-sdk：HTTP useChat 后端（SSE、全量历史重放、工具调用）",
  agent: uiMessageStreamAgent({ url: `${BASE_URL}/api/chat` }),
  model: DEFAULT_MODEL,
  // attempts: 3 + earlyExit 吸收单次真实模型抖动；连续三次失手是真回归，矩阵应保持红。
  attempts: 3,
  earlyExit: true,
  budget: 1,
});
