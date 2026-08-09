// Plugin + hook 信任闭环。Codex 的 `codex plugin marketplace add owner/repo` 在容器内部靠
// 系统 `git clone` 实现;项目级 sandbox(niceeval.config.ts)已经是烘焙了 git 的官方
// niceeval/codex 镜像,这里不需要再单独装 git。
import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";
import { sandbox } from "../sandbox.ts";

const agent = codexAgent({
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

export default defineExperiment({
  description: "codex-cli Plugin + hook 信任闭环:marketplace 安装可观察,SessionStart hook 在 bypass 姿态下真实执行",
  agent,
  model: "gpt-5.6-luna",
  sandbox,
  evals: ["plugin-hook"],
  attempts: 1,
  budget: 2,
});
