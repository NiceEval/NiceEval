import { defineExperiment } from "niceeval";
import agent from "../../agents/codex-sdk.ts";

// compare-sandbox 组的一格:workspace-write(SDK 在工作目录里的默认可写档)。params 经
// ctx.params 透传,adapter 塞进请求体的 sandboxMode 字段,应用把它交给 threadOptions。
export default defineExperiment({
  description: "workspace-write: 沙箱可写(默认档)",
  agent,
  params: { sandboxMode: "workspace-write" },
  attempts: 1,
});
