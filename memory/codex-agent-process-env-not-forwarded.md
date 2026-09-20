---
format: concord.document/v1
id: codex-agent-process-env-not-forwarded
title: Codex factory 没有把条件环境注入实际 Agent 进程
createdAt: 2026-08-02T15:18:14+08:00
createdAtSource:
  kind: first-recorded
  path: memory/codex-agent-process-env-not-forwarded.md
  commit: 0d24186331cc787226bccdc99c515ff8b7f331a6
kind: memory
memoryKind: problem
state: resolved
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: "- 已修 [codex-agent-process-env-not-forwarded](codex-agent-process-env-not-forwarded.md) — Codex factory 曾无法声明实际 `exec` / `exec resume` 的 ambient env，Nowledge 的 `NMEM_SPACE` 因而到不了 MCP 动态 header、Session Hook 与 `nmem` 子进程；修为 `codexAgent({ env })` 经 command options 逐轮注入，值不进 shell/manifest 并登记脱敏"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---
# Codex factory 没有把条件环境注入实际 Agent 进程

## 现象

Nowledge Codex Plugin 的托管 HTTP MCP 配置通过 `env_http_headers` 从 Codex 进程读取 `NMEM_SPACE`。SessionStart / SessionStop Hook 与 Agent 调起的 `nmem` CLI 也依赖同一个 ambient environment。

NiceEval 原有 `codexAgent` 只给 `codex exec` 注入 `CODEX_API_KEY`。Experiment 无法声明 Space；把变量写进宿主环境或 setup shell 也不会自动进入后续独立启动的 Codex 进程。复用同一授权 server 时，不同实验因此可能读写同一个默认 Space。

## 根因

`CodexConfig` 没有 Agent 进程环境字段。Adapter 每轮重新构造 `CommandOptions.env`，但该对象只包含鉴权值；首次 `exec` 与 `exec resume` 都没有用户声明的环境。

Codex 的 Session Hook、MCP 动态 header 与命令子进程都会继承 `codex exec` 的环境。正确注入边界是启动 Codex 的 Sandbox command options，不是把 `export` 拼进 shell 文本，也不是改 task workspace。

## 修法

`codexAgent({ env })` 在 factory 构造时快照声明，并在每次首轮 / resume 命令中与 Adapter 鉴权环境合并。`CODEX_API_KEY` 仍由 `apiKey` 或宿主同名变量提供，并覆盖 `env` 的同名键。

环境值不进入 shell 文本或 setup manifest。全部声明值进入同一条命令的 `sensitiveValues`，由 runner 在 timing、execution、失败命令与最终错误证据落盘前统一脱敏。

## 守护

`src/agents/codex-env.test.ts` 用同一 Session 连跑首轮与 resume，断言两条 Sandbox 命令取得相同 `env`，同时断言键值不在 shell 文本且全部值登记为潜在敏感值。
