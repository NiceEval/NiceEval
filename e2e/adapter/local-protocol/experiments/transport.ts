import { defineExperiment } from "niceeval";
import { uiMessageStreamAgent } from "niceeval/adapter";

// 公开 adapter 入口：uiMessageStreamAgent（docs/source-map.md / docs/feature/adapters/sdk/ai-sdk）。
// 本实验只证明 NiceEval 自有 HTTP SSE transport 能对着签入 fixture 完成一轮往返；
// 不覆盖 live AI SDK 的工具 / HITL / session 形状矩阵（那属于 adapter/ai-sdk）。
const BASE = process.env.LOCAL_PROTOCOL_URL ?? "http://127.0.0.1:34201";

export default defineExperiment({
  description: "local-protocol transport: canned SSE 完整 text 往返",
  agent: uiMessageStreamAgent({
    name: "local-protocol-ok",
    url: `${BASE}/modes/ok/api/chat`,
  }),
  model: "local-protocol-fixture",
  evals: ["transport-ok"],
});
