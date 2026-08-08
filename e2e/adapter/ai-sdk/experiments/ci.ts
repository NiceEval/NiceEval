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

// Direct Agent 不声明 Sandbox：共享断言契约的 tool-match-and-sandbox 对真实工具事件
// 执行完整 ToolMatch，t.sandbox 专属段由 profile 的 sandboxUnavailable: true 跳过
// （应用文件工具是内存实现，见 src/backend/tools.ts）。

// 单一实验:共享断言契约与仓库全部 Eval 共用同一个 uiMessageStreamAgent。
// attempts: 3 + earlyExit absorbs a single real-model blip; three consecutive misses is a
// genuine regression and the matrix should stay red for it.
export default defineExperiment({
  description: "ai-sdk:HTTP useChat 后端(SSE、全量历史重放、审批改写重发、OTel)与共享断言契约",
  agent,
  model: DEFAULT_MODEL,
  attempts: 3,
  earlyExit: true,
  budget: 1,
  evals: (e) =>
    e.id.startsWith("assertion-contract/") || ["tool-call", "hitl-approval", "session-replay"].includes(e.id),
});
