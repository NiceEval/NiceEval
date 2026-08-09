import { defineExperiment } from "niceeval";
import { uiMessageStreamAgent } from "niceeval/adapter";
import { DEFAULT_MODEL } from "../src/backend/models.ts";
import { AI_SDK_BASE_URL } from "../src/topology.ts";

const agent = uiMessageStreamAgent({
  name: "ai-sdk-ui-message-stream",
  url: `${AI_SDK_BASE_URL}/api/chat`,
});

// 单一实验:仓库全部三条 Eval 共用同一个 uiMessageStreamAgent。
// Live compatibility observes one real attempt; retries must not rewrite a first failure as green.
export default defineExperiment({
  description: "ai-sdk:HTTP useChat 后端(SSE、全量历史重放、审批改写重发、OTel)",
  agent,
  model: DEFAULT_MODEL,
  attempts: 1,
  evals: ["tool-call", "hitl-approval", "session-replay"],
});
