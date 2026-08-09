---
title: 'E2E lane 计划与默认批量执行的 Repo 集合不一致'
severity: 'major'
---

## Expected Behavior
`pnpm e2e --lane main` 应执行 `pnpm e2e plan --lane main --json` 所列的同一组 Repo；计划与实际运行对象必须一致，避免误触发范围外的联网或付费测试。

## Current Behavior
在计划只列出六个 coding-agent Repo（`adapter/bub`、`adapter/claude-code`、`adapter/codex-cli`、`adapter/hermes`、`adapter/openclaw`、`adapter/opencode`）后，执行入口却首先运行 `adapter/ai-sdk`。已立即中断，退出码 130。逐 Repo 的 `e2e run --repo` 可作为显式绕行。

## Possible Solution
让默认执行入口直接消费已生成的 plan 或共用完全相同的 lane/repo 选择结果，并在启动每个 Repo 前校验其属于计划；增加计划—执行一致性的确定性回归检查。

## Minimal Reproducible Example
```sh
pnpm e2e plan --lane main --json
pnpm e2e --lane main
```

## Context
在六个官方 coding-agent Adapter 切换到版本锁定官方 Docker image 后做 live E2E 验收时发现。批量执行日志的第一个 Repo 已与刚生成的计划不一致，因此为避免范围外模型调用而中断。
