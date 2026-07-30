import { defineConfig } from "niceeval";
import { dockerSandbox } from "niceeval/sandbox";

export default defineConfig({
  name: { "zh-CN": "e2e: codex-cli (codexAgent, docker sandbox)", en: "e2e: codex-cli (codexAgent, docker sandbox)" },
  // NICEEVAL_JUDGE_BASE 这个网关只认 deepseek-v4-pro / deepseek-v4-flash(实测确认,同一凭据
  // 已在 e2e/adapter/codex-sdk 验证过),不是通用 OpenAI 兼容网关,不能沿用 gpt-5.4 之类的模型名。
  // judge 端点是配置,niceeval 不再内置读任何环境变量:这里自己读 NICEEVAL_JUDGE_BASE
  // (值在本仓库 .env / CI secret 里),key 仍由 niceeval 按 NICEEVAL_JUDGE_KEY 读。
  judge: { model: "deepseek-v4-flash", baseUrl: process.env.NICEEVAL_JUDGE_BASE },
  // 用 NiceEval 官方预制镜像(sandbox/README.md「Docker」),codex CLI 与 git/curl/
  // ca-certificates 都已烘焙进镜像,agent setup 的 `command -v codex` 直接命中、跳过
  // npm install -g;多架构 manifest 也顺带避开 Apple Silicon 本机拉 amd64 镜像走 QEMU
  // 模拟的问题。升级 CLI 版本(coding-cli-versions.ts)时同步把这里的 tag 换成对应的新 release。
  // lifetimeMs 是容器 TTL,也是 sandboxReuse 派发前寿命确认的唯一依据:docker 容器的 TTL
  // 烧在 PID1 里没有续期通道,不声明它时声明了复用的实验(experiments/plugin-reuse.ts)在
  // 第一条 attempt 派发前就报错。30 分钟覆盖复用实验的两条 attempt(每条 timeoutMs 10 分钟)。
  sandbox: dockerSandbox({ image: "niceeval/codex:v0.9.1", lifetimeMs: 30 * 60_000 }),
  // 沙箱型 agent 每个 attempt 都是全新容器;CLI 已随镜像预装,但 setup 阶段的
  // skills/MCP/plugin 仍要装;实测本机单次 attempt 数十秒到数分钟,10 分钟放足余量。
  timeoutMs: 600_000,
  maxConcurrency: 2,
});
