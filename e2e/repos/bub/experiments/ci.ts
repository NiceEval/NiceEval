import { defineExperiment } from "niceeval";
import agent from "../agents/bub.ts";

// 单一实验:全部 4 条 Eval 共用同一个 agent 变体和同一份安装 checkpoint,只证明协议路径通
// (docs/engineering/e2e-ci/adapters/README.md「仓库 Eval 预算」),不做多样本统计。
export default defineExperiment({
  description: "bub: real Bub CLI in a Docker sandbox against the s2a OpenAI-compatible gateway",
  agent,
  // 网关(s2a.niceeval.com)不识别 bub 的默认模型别名;显式钉一个网关确认可用的便宜档模型
  // (README「secrets 与真实服务」:PR 门禁用便宜模型与小样本)。
  model: "gpt-5.4-mini",
  runs: 1,
});
