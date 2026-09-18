---
format: concord.document/v1
id: codex-agent-env-var-doc-drift
title: docs-site 里 codex agent 的鉴权 env var 曾写错——不是 `OPENAI_API_KEY`，是 `CODEX_API_KEY`
createdAt: 2026-07-02T13:38:43+08:00
createdAtSource:
  kind: first-recorded
  path: memory/codex-agent-env-var-doc-drift.md
  commit: ac64bbbda30ad7cb6de15cec39ad94f7517c6885
kind: memory
memoryKind: problem
state: resolved
epoch: 0
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: "- 已修
      [codex-agent-env-var-doc-drift](codex-agent-env-var-doc-drift.md) — codex
      agent 鉴权是 `CODEX_API_KEY` 不是 `OPENAI_API_KEY`,文档曾照名字直觉写错"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---
# docs-site 里 codex agent 的鉴权 env var 曾写错——不是 `OPENAI_API_KEY`，是 `CODEX_API_KEY`

**现象**：`docs-site/zh/guides/sandbox-agent.mdx`（Card 描述 + 环境变量表）写 codex 内置 agent 需要 `OPENAI_API_KEY`；`docs-site/quickstart.mdx`、`docs-site/installation.mdx`、`docs-site/zh/guides/ci-integration.mdx` 也都示范设置 `OPENAI_API_KEY` 给 codex 用。

**根因**：`src/agents/codex.ts` 的 `getApiKey` 实际读 `requireEnv("CODEX_API_KEY")`（配 `CODEX_BASE_URL` 走 OpenAI 兼容代理），从没读过 `OPENAI_API_KEY`。文档大概率是照着 "OpenAI Codex" 这个名字直觉写的，没有对照源码。

**修法**：已把 `docs-site/zh/guides/sandbox-agent.mdx` 的两处改成 `CODEX_API_KEY`（配合新增的 `docs-site/zh/reference/builtin-agents.mdx`）。`docs-site/quickstart.mdx`、`installation.mdx`（英文入口）、`zh/guides/ci-integration.mdx` 里的 `OPENAI_API_KEY` 引用还没改——按 CLAUDE.md「中文内容是准绳」的规则，下次touch这几个文件时要一并同步成 `CODEX_API_KEY`。
