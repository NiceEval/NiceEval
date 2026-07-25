import { defineExperiment } from "niceeval";
import { bubAgent } from "niceeval/adapter";
import type { SandboxHook } from "niceeval/sandbox";

const POSTSETUP_ORDER_LOG = "/tmp/niceeval-bub-postsetup-order.log";
const markFirst: SandboxHook = async (sandbox) => {
  await sandbox.runShell(`printf 'first\\n' >> ${POSTSETUP_ORDER_LOG}`);
};
const markSecond: SandboxHook = async (sandbox) => {
  await sandbox.runShell(`printf 'second\\n' >> ${POSTSETUP_ORDER_LOG}`);
};

// 不写 version:这条线始终跑 NiceEval 当前默认钉的 Bub,默认版本一升级它就跟着换代。
// 往回钉一代的覆盖在 experiments/legacy.ts。
const agent = bubAgent({
  skills: [{ kind: "local", path: "skills/review/SKILL.md" }],
  pythonPlugins: [{ package: "cowsay" }],
  postSetup: [markFirst, markSecond],
});

// 单一实验:全部 4 条 Eval 共用同一个 agent 变体和同一份安装 checkpoint,只证明协议路径通
// (docs/engineering/testing/e2e/adapter/README.md「仓库 Eval 预算」),不做多样本统计。
export default defineExperiment({
  description: "bub:真实 Bub CLI 在 Docker 沙箱内,针对 s2a OpenAI 兼容网关跑通协议路径",
  agent,
  // 网关(s2a.niceeval.com)不识别 bub 的默认模型别名;显式钉一个网关确认可用的便宜档模型
  // (README「secrets 与真实服务」:PR 门禁用便宜模型与小样本)。
  model: "gpt-5.4-mini",
  runs: 1,
});
