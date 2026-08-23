---
{
  "format": "niceeval.feedback/v1",
  "id": "20260822113707-accept-无法迁移-errored",
  "title": "accept 无法迁移 errored attempt 导致身份变更后结果缺失",
  "state": "open",
  "reportedAt": "2026-08-22T11:37:07+08:00",
  "source": {
    "kind": "dev",
    "repository": "NiceEval/NiceEval"
  },
  "subject": "product",
  "claim": "friction",
  "observation": "---\ntitle: 'accept 无法迁移 errored attempt 导致身份变更后结果缺失'\nseverity: 'major'\n---\n\n## Expected Behavior\n当项目因 workspace 包路径调整而改变 execution identity 时，用户可通过公开 CLI 将历史 run 的全部 attempt（包括 errored attempt）明确采纳到当前 identity，无需重跑付费模型。\n\n## Current Behavior\n`niceeval accept` 对包含 errored attempt 的 locator 返回 `attempt-not-completed`，且事务整体失败。只能逐个排除 errored locator 后采纳其余 completed attempt，导致原有错误结果在新 identity 下显示为 not-recorded。\n\n## Possible Solution\n允许 accept 显式采纳 completed/failed/errored 的终态 attempt，或提供公开的 run identity migration 命令；批量采纳时也可报告并跳过不可采纳项而不是整批回滚。\n\n## Minimal Reproducible Example\n1. 运行实验并产生至少一个 errored attempt。\n2. 调整 workspace package 路径，使 execution identity 改变。\n3. 对旧 run 执行 `niceeval accept @<errored-locator>`。\n4. CLI 返回 `attempt-not-completed`，无法在不重跑 provider 的前提下保留该错误结果。\n\n## Context\nMemoryBench PR preview 从 NiceEval 根包迁移到 `packages/niceeval` 后，旧结果全部 identity-mismatch。46 个 completed attempt 可采纳，但 2 个 errored attempt 无法迁移，因此标准报告中成为缺失数据。\n",
  "impact": "`niceeval accept` 对包含 errored attempt 的 locator 返回 `attempt-not-completed`，且事务整体失败。只能逐个排除 errored locator 后采纳其余 completed attempt，导致原有错误结果在新 identity 下显示为 not-recorded。",
  "memoryRelations": []
}
---
---
title: 'accept 无法迁移 errored attempt 导致身份变更后结果缺失'
severity: 'major'
---

## Expected Behavior
当项目因 workspace 包路径调整而改变 execution identity 时，用户可通过公开 CLI 将历史 run 的全部 attempt（包括 errored attempt）明确采纳到当前 identity，无需重跑付费模型。

## Current Behavior
`niceeval accept` 对包含 errored attempt 的 locator 返回 `attempt-not-completed`，且事务整体失败。只能逐个排除 errored locator 后采纳其余 completed attempt，导致原有错误结果在新 identity 下显示为 not-recorded。

## Possible Solution
允许 accept 显式采纳 completed/failed/errored 的终态 attempt，或提供公开的 run identity migration 命令；批量采纳时也可报告并跳过不可采纳项而不是整批回滚。

## Minimal Reproducible Example
1. 运行实验并产生至少一个 errored attempt。
2. 调整 workspace package 路径，使 execution identity 改变。
3. 对旧 run 执行 `niceeval accept @<errored-locator>`。
4. CLI 返回 `attempt-not-completed`，无法在不重跑 provider 的前提下保留该错误结果。

## Context
MemoryBench PR preview 从 NiceEval 根包迁移到 `packages/niceeval` 后，旧结果全部 identity-mismatch。46 个 completed attempt 可采纳，但 2 个 errored attempt 无法迁移，因此标准报告中成为缺失数据。
