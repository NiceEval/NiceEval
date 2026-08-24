---
title: 'pr:body check 拒绝仓库规则要求的 --no-remote'
severity: 'minor'
---

## Expected Behavior

仓库 AGENTS.md 要求创建 PR 前运行 `pnpm pr:body check --source <draft.md> --no-remote`。当前 CLI 应接受该显式本地模式参数，或仓库规则应与 CLI help 一致地省略它。

## Current Behavior

`pnpm pr:body check --source <draft.md> --no-remote` 立即失败为 `Received unknown argument: --no-remote`。与此同时，`pnpm pr:body check --help` 只列出正向 `--remote`，并说明 local validation is the default。

## Possible Solution

让布尔参数支持 `--no-remote`，或把 AGENTS.md 和其它示例统一改成不带该参数的默认本地检查命令，并为命令示例加一个可执行校验。

## Minimal Reproducible Example

先运行 `pnpm pr:body init --source <draft.md> --base main`，再运行 `pnpm pr:body check --source <draft.md> --no-remote`。当前候选在解析参数阶段以 exit code 1 退出；删除 `--no-remote` 后进入正常校验。

## Context

为确定性 Report preview 创建 PR 时，严格执行仓库级 Git 协作规则触发。它会让自动化 agent 在已明确要求的发布门上停住，并需要人工判断 CLI help 优先于规则示例。
