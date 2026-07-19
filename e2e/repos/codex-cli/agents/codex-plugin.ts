// Plugin + hook 信任实验专用:同一个 codex adapter,挂一个真实、公开、专为这条 E2E 建的
// Marketplace 仓库(CorrectRoadH/niceeval-e2e-codex-hook-fixture,ref 钉死到一个固定 commit)。
// 它只注册一个 Marketplace(niceeval-e2e-plugins)和一个 Plugin(hook-demo),Plugin 的唯一
// 内容是一个 SessionStart 钩子:`echo NICEEVAL_HOOK_SENTINEL_926`。
//
// 为什么不用已有的第三方 Marketplace(如 duyet/codex-claude-plugins 的 "commit" plugin,
// 已被 e2e/projects/codex 用来验证过安装机制):那个 plugin 是纯 slash command,没有 hook,
// 证明不了"hook 在 bypass 信任姿态下确实生效"这条协议行为——必须是一个真的带 hook 的
// plugin。本仓库自建这个最小 fixture(见该仓库 README),而不是去找一个功能更重的第三方
// hook plugin(如下游 coding-agent-memory-evals 用的 nowledge-mem,需要额外的容器/隧道基础
// 设施,对这条 E2E 而言是过度的依赖)。
//
// `marketplace.name` 必须原样等于目标仓库 `.agents/plugins/marketplace.json` 里的
// `"name"` 字段("niceeval-e2e-plugins"),不是调用方随意起的别名——这是 Codex/Claude Code
// native plugin 的既有限制(见 memory/native-plugin-marketplace-name-not-caller-assignable.md)。
//
// `codex plugin marketplace add owner/repo` 在沙箱内部靠系统 `git clone` 实现(实测
// node:24-slim 默认镜像不带 git),所以只有这个实验的 sandbox 需要额外装 git——见
// experiments/plugin.ts 的 sandbox.setup() 钩子,不在项目级 niceeval.config.ts 里全局装。
import { codexAgent } from "niceeval/adapter";

export default codexAgent({
  apiKey: process.env.CODEX_API_KEY,
  baseUrl: process.env.CODEX_BASE_URL,
  plugins: [
    {
      marketplace: {
        name: "niceeval-e2e-plugins",
        source: "CorrectRoadH/niceeval-e2e-codex-hook-fixture",
        ref: "343b07bc8b204cd7f524d2dd4367f83409c98c29",
      },
      name: "hook-demo",
    },
  ],
});
