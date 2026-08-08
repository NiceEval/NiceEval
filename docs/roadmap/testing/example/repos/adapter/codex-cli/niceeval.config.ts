import { defineConfig } from "niceeval";
import { dockerImageSandbox } from "niceeval/sandbox";

export default defineConfig({
  name: { "zh-CN": "example: codex-cli（codexAgent, docker sandbox）", en: "example: codex-cli (codexAgent, docker sandbox)" },
  // 官方预制镜像（docs/feature/sandbox/ 的 Docker 说明）：codex CLI 与 git/curl 已烘焙进
  // 镜像。lifetimeMs 是容器 TTL（30 分钟覆盖两条 attempt，每条 timeoutMs 10 分钟）。
  sandbox: dockerImageSandbox({ image: "niceeval/codex:v0.9.1", lifetimeMs: 30 * 60_000 }),
  // 沙箱型 agent 每个 attempt 都是全新容器；setup 阶段要装扩展，10 分钟放足余量。
  timeoutMs: 600_000,
  maxConcurrency: 2,
});
