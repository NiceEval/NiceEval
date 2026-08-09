import { defineExperiment } from "niceeval";
import { uiMessageStreamAgent } from "niceeval/adapter";
import { DEFAULT_MODEL } from "../src/backend/models.ts";

const BASE_URL = process.env.AI_SDK_URL ?? "http://127.0.0.1:34101";
const agent = uiMessageStreamAgent({
  name: "ai-sdk-ui-message-stream",
  url: `${BASE_URL}/api/chat`,
  // 应用用 BatchSpanProcessor,流结束后留一段宽限让最后一批 span 落进本轮收集窗口
  // (只影响 `niceeval view` / `show --execution` 的瀑布图,不影响断言)。
  settleMs: 600,
});

// 单一实验:仓库全部三条 Eval 共用同一个 uiMessageStreamAgent。
// attempts: 3 + earlyExit absorbs a single real-model blip; three consecutive misses is a
// genuine regression and the matrix should stay red for it.
export default defineExperiment({
  description: "ai-sdk:HTTP useChat 后端(SSE、全量历史重放、审批改写重发、OTel)",
  agent,
  model: DEFAULT_MODEL,
  attempts: 3,
  earlyExit: true,
  budget: 1,
  evals: ["tool-call", "hitl-approval", "session-replay"],
});
