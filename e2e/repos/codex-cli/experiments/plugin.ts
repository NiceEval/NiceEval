// Plugin + hook 信任闭环。这是本仓库唯一需要沙箱内有 `git` 的实验——Codex 的
// `codex plugin marketplace add owner/repo` 在容器内部靠系统 `git clone` 实现,而默认镜像
// (node:24-slim)不带 git(本仓库设计阶段已用真实 Docker 容器核对过:默认镜像跑
// `codex plugin marketplace add <owner>/<repo>` 会报 "failed to run git clone ... No such
// file or directory")。`sandbox.setup()` 钩子运行在 `agent.setup`(codexAgent 的
// installPlugins)之前,是唯一能在这个内置 Adapter 的既有生命周期里插入"装 git"这一步的
// 位置——只覆盖这一个实验的 sandbox,不在项目级 niceeval.config.ts 里全局装,其它实验不需要
// 这份 apt-get 开销。
import { defineExperiment } from "niceeval";
import { dockerSandbox } from "niceeval/sandbox";
import agent from "../agents/codex-plugin.ts";

export default defineExperiment({
  description: "codex-cli Plugin + hook 信任闭环:marketplace 安装可观察,SessionStart hook 在 bypass 姿态下真实执行",
  agent,
  model: "gpt-5.4-mini",
  evals: ["plugin-hook"],
  runs: 1,
  budget: 2,
  sandbox: dockerSandbox().setup(async (sb) => {
    await sb.runShell("apt-get update -qq && apt-get install -y -qq --no-install-recommends git >/dev/null");
  }),
});
