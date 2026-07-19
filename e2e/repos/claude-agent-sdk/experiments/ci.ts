import { defineExperiment } from "niceeval";
import agent from "../agents/claude-agent-sdk.ts";

// 单一实验:本仓库只证明协议路径通,不比较模型或做多样本统计——见
// docs/engineering/e2e-ci/adapters/README.md「仓库 Eval 预算」。
export default defineExperiment({
  description: "claude-agent-sdk:真实 Claude Agent SDK backend 对接 DeepSeek 的 Anthropic-Messages 兼容端点",
  agent,
  runs: 1,
});
