import { defineExperiment } from "niceeval";
import { uiMessageStreamAgent } from "niceeval/adapter";

const BASE = process.env.LOCAL_PROTOCOL_URL ?? "http://127.0.0.1:34201";

export default defineExperiment({
  description: "local-protocol timeout: fixture 挂起直到 attempt 超时",
  agent: uiMessageStreamAgent({
    name: "local-protocol-timeout",
    url: `${BASE}/modes/hang/api/chat`,
  }),
  model: "local-protocol-fixture",
  // 短于 config 默认，保证本场景在数秒内可观察 timeout 阶段，不拖垮 PR lane。
  timeoutMs: 4_000,
  evals: ["timeout"],
});
