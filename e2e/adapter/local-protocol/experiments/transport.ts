import { defineExperiment } from "niceeval";
import { uiMessageStreamAgent } from "niceeval/adapter";
import { fixtureBaseUrl } from "../src/fixture/address.ts";

// 公开 adapter 入口：uiMessageStreamAgent（docs/source-map.md / docs/feature/adapters/sdk/ai-sdk）。
// 本实验只证明 NiceEval 自有 HTTP SSE transport 能对着签入 fixture 完成一轮往返；
// approval 的确定性状态机由 experiments/approval.ts 拥有，live SDK 兼容性仍属于 adapter/ai-sdk。
export default defineExperiment({
  description: "local-protocol transport: canned SSE 完整 text 往返",
  agent: uiMessageStreamAgent({
    name: "local-protocol-ok",
    url: `${fixtureBaseUrl()}/modes/ok/api/chat`,
  }),
  model: "local-protocol-fixture",
  evals: ["transport-ok"],
});
