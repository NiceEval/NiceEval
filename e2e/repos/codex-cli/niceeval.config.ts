import { defineConfig } from "niceeval";
import { dockerSandbox } from "niceeval/sandbox";

export default defineConfig({
  name: { "zh-CN": "e2e: codex-cli (codexAgent, docker sandbox)", en: "e2e: codex-cli (codexAgent, docker sandbox)" },
  // NICEEVAL_JUDGE_BASE 这个网关只认 deepseek-v4-pro / deepseek-v4-flash(实测确认,同一凭据
  // 已在 e2e/repos/codex-sdk 验证过),不是通用 OpenAI 兼容网关,不能沿用 gpt-5.4 之类的模型名。
  judge: { model: "deepseek-v4-flash" },
  // 默认镜像(node:24-slim)够用;plugin 实验按需自带一个额外的 git 安装 setup 钩子
  // (见 experiments/plugin.ts),不在这里全局装 git——其它实验不需要,省下每 attempt 的
  // apt-get 开销。
  sandbox: dockerSandbox(),
  // 沙箱型 agent 每个 attempt 都是全新容器,要重装 CLI(+ setup 阶段的 skills/MCP/plugin);
  // 实测本机单次 attempt 数十秒到数分钟,10 分钟放足余量。
  timeoutMs: 600_000,
  maxConcurrency: 2,
});
