---
{
  "format": "niceeval.feedback/v1",
  "id": "20260815015955-openclaw-真实模型-e2e",
  "title": "OpenClaw 真实模型 E2E 的 coding-task 首轮重复抖动",
  "state": "open",
  "reportedAt": "2026-08-15T01:59:55+08:00",
  "source": {
    "kind": "dev",
    "repository": "NiceEval/NiceEval"
  },
  "subject": "dependency",
  "claim": "friction",
  "observation": "---\ntitle: 'OpenClaw 真实模型 E2E 的 coding-task 首轮重复抖动'\nseverity: 'minor'\n---\n\n## Expected Behavior\n\nPR 的 docker E2E 在产品候选与 OpenClaw adapter 契约没有变化时应稳定裁决；外部模型单次任务波动不应让整条必需 gate 在首次运行失败、仅重跑又通过。\n\n## Current Behavior\n\nPR #51 的两个不同 head 上，`adapter/openclaw` 都只有 `coding-task/write-and-verify` 在首次运行判定 failed，另外 3 个 OpenClaw eval 与同 lane 的另外 7 个 repo 全部通过。较早一轮只重跑失败 lane 后整体通过；后一轮再次命中同一 eval。E2E orchestrator 将它分类为 `regression`，无法与产品代码回归区分。\n\n## Possible Solution\n\n为真实模型行为 gate 定义有界、可审计的单 eval 重试或稳定性预算，并在 receipt 中区分“首次模型判定波动后通过”与产品回归；也可把非确定性 coding task 从每个 PR 的硬 gate 移到独立持续评估，同时保留确定性的 adapter 协议 gate。\n\n## Minimal Reproducible Example\n\n在 PR #51 上运行完整 `e2e` workflow。Actions run `31823960212` 与 `31826116754` 的 `repo-batch-docker-1` 都在 `adapter/openclaw/test/openclaw.test.ts:65` 观察到 `niceeval exp --rerun all --json` exit 1；事件中只有 `coding-task/write-and-verify` failed。对前一 run 执行 failed-jobs rerun 后 attempt 2 全绿。\n\n## Context\n\n两次失败分别发生在仅英文文档变更的 `ea1fd096` 与 locator/terminal 安全修复的 `39382b0e`；两轮 host、browser、CI 以及 docker lane 的其它 repo 都通过。\n",
  "impact": "PR #51 的两个不同 head 上，`adapter/openclaw` 都只有 `coding-task/write-and-verify` 在首次运行判定 failed，另外 3 个 OpenClaw eval 与同 lane 的另外 7 个 repo 全部通过。较早一轮只重跑失败 lane 后整体通过；后一轮再次命中同一 eval。E2E orchestrator 将它分类为 `regression`，无法与产品代码回归区分。",
  "memoryRelations": []
}
---
---
title: 'OpenClaw 真实模型 E2E 的 coding-task 首轮重复抖动'
severity: 'minor'
---

## Expected Behavior

PR 的 docker E2E 在产品候选与 OpenClaw adapter 契约没有变化时应稳定裁决；外部模型单次任务波动不应让整条必需 gate 在首次运行失败、仅重跑又通过。

## Current Behavior

PR #51 的两个不同 head 上，`adapter/openclaw` 都只有 `coding-task/write-and-verify` 在首次运行判定 failed，另外 3 个 OpenClaw eval 与同 lane 的另外 7 个 repo 全部通过。较早一轮只重跑失败 lane 后整体通过；后一轮再次命中同一 eval。E2E orchestrator 将它分类为 `regression`，无法与产品代码回归区分。

## Possible Solution

为真实模型行为 gate 定义有界、可审计的单 eval 重试或稳定性预算，并在 receipt 中区分“首次模型判定波动后通过”与产品回归；也可把非确定性 coding task 从每个 PR 的硬 gate 移到独立持续评估，同时保留确定性的 adapter 协议 gate。

## Minimal Reproducible Example

在 PR #51 上运行完整 `e2e` workflow。Actions run `31823960212` 与 `31826116754` 的 `repo-batch-docker-1` 都在 `adapter/openclaw/test/openclaw.test.ts:65` 观察到 `niceeval exp --rerun all --json` exit 1；事件中只有 `coding-task/write-and-verify` failed。对前一 run 执行 failed-jobs rerun 后 attempt 2 全绿。

## Context

两次失败分别发生在仅英文文档变更的 `ea1fd096` 与 locator/terminal 安全修复的 `39382b0e`；两轮 host、browser、CI 以及 docker lane 的其它 repo 都通过。
