---
title: 'Claude Code live E2E 引用已删除的 plugin marketplace fixture'
severity: 'major'
---

## Expected Behavior
`adapter/claude-code` 的 live E2E 应从干净 checkout 完成 experiment discovery，并进入官方 Docker image 中的真实 Agent Journey。

## Current Behavior
`sandbox.ts` 在模块顶层对 `fixtures/plugins/e2e-marketplace` 执行 `lstat`，但该目录及三个 marketplace/plugin 描述文件已在测试重置提交中删除。结果六个 experiment 都报 `discovery.import-failed`，E2E 在启动 Agent 前退出 1。

## Possible Solution
在自动化产品测试重置政策允许恢复资产后，重新裁定 plugin Journey 的 owner：若保留该 Journey，恢复最小 marketplace fixture 并确保打包复制；若不保留，则同步删除 plugin experiments 与相关断言/文档，不留下悬空引用。

## Minimal Reproducible Example
```sh
pnpm e2e run --candidate /tmp/candidate.tgz --repo adapter/claude-code
```

## Context
将六个 coding-agent live E2E 切换到版本锁定官方 Docker image 后验收发现。诊断时临时补齐该 Repo 缺失的 pnpm build 审批配置，安装通过后随即稳定复现缺失 fixture；临时配置未纳入改动，且当前仓库规则禁止新增或恢复 `e2e/**` 自动化测试资产，因此本轮不能修复。
