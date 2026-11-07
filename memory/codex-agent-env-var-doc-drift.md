# docs-site 里 codex agent 的鉴权 env var 曾写错——不是 `OPENAI_API_KEY`，是 `CODEX_API_KEY`

**现象**：`docs-site/zh/guides/sandbox-agent.mdx`（Card 描述 + 环境变量表）写 codex 内置 agent 需要 `OPENAI_API_KEY`；`docs-site/quickstart.mdx`、`docs-site/installation.mdx`、`docs-site/zh/guides/ci-integration.mdx` 也都示范设置 `OPENAI_API_KEY` 给 codex 用。

**根因**：`src/agents/codex.ts` 的 `getApiKey` 实际读 `requireEnv("CODEX_API_KEY")`（配 `CODEX_BASE_URL` 走 OpenAI 兼容代理），从没读过 `OPENAI_API_KEY`。文档大概率是照着 "OpenAI Codex" 这个名字直觉写的，没有对照源码。

**修法**：已把 `docs-site/zh/guides/sandbox-agent.mdx` 的两处改成 `CODEX_API_KEY`（配合新增的 `docs-site/zh/reference/builtin-agents.mdx`）。`docs-site/quickstart.mdx`、`installation.mdx`（英文入口）、`zh/guides/ci-integration.mdx` 里的 `OPENAI_API_KEY` 引用还没改——按 CLAUDE.md「中文内容是准绳」的规则，下次touch这几个文件时要一并同步成 `CODEX_API_KEY`。
