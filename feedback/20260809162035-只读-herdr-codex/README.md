---
{
  "format": "niceeval.feedback/v1",
  "id": "20260809162035-只读-herdr-codex",
  "title": "只读 Herdr Codex worker 无法发送完成通知",
  "state": "open",
  "reportedAt": "2026-08-09T16:20:35+08:00",
  "source": {
    "kind": "dev",
    "repository": "NiceEval/NiceEval"
  },
  "subject": "dependency",
  "claim": "friction",
  "observation": "---\ntitle: '只读 Herdr Codex worker 无法发送完成通知'\nseverity: 'minor'\n---\n\n## Expected Behavior\n\n以 `-s read-only -a never` 启动的 Herdr Codex worker 完成只读研究后，可以按父任务约定执行一次 `herdr agent prompt <parent-pane-id> <message>`，只向父 pane 发送完成通知。\n\n## Current Behavior\n\n四个独立的 `gpt-5.6-sol` read-only worker 都完成研究，但执行完成通知时返回 `Operation not permitted`。研究本身正常，父 agent 只能靠轮询发现完成。\n\n## Possible Solution\n\n将向已存在父 agent 发送一条 prompt 视为只读 worker 的受限调度能力，或由 Herdr 提供不要求文件系统写权限的专用 completion signal。\n\n## Minimal Reproducible Example\n\n1. 在 Herdr pane 中执行 `herdr agent start child --kind codex --pane <child-pane> -- -m gpt-5.6-sol -c model_reasoning_effort=max -s read-only -a never`。\n2. 向 child 下发只读任务，并要求结束前执行一次 `herdr agent prompt <parent-pane-id> \"[WORKER_READY_FOR_ACCEPTANCE] ...\"`。\n3. worker 完成后该命令返回 `Error: Os { code: 1, kind: PermissionDenied, message: \"Operation not permitted\" }`。\n\n## Context\n\n本次并行研究要求 worker 主动提醒父 agent 开始 wait/get/read/验收。四个 worker 的通知都失败，增加了遗漏回收义务的风险。\n",
  "impact": "四个独立的 `gpt-5.6-sol` read-only worker 都完成研究，但执行完成通知时返回 `Operation not permitted`。研究本身正常，父 agent 只能靠轮询发现完成。",
  "memoryRelations": []
}
---
---
title: '只读 Herdr Codex worker 无法发送完成通知'
severity: 'minor'
---

## Expected Behavior

以 `-s read-only -a never` 启动的 Herdr Codex worker 完成只读研究后，可以按父任务约定执行一次 `herdr agent prompt <parent-pane-id> <message>`，只向父 pane 发送完成通知。

## Current Behavior

四个独立的 `gpt-5.6-sol` read-only worker 都完成研究，但执行完成通知时返回 `Operation not permitted`。研究本身正常，父 agent 只能靠轮询发现完成。

## Possible Solution

将向已存在父 agent 发送一条 prompt 视为只读 worker 的受限调度能力，或由 Herdr 提供不要求文件系统写权限的专用 completion signal。

## Minimal Reproducible Example

1. 在 Herdr pane 中执行 `herdr agent start child --kind codex --pane <child-pane> -- -m gpt-5.6-sol -c model_reasoning_effort=max -s read-only -a never`。
2. 向 child 下发只读任务，并要求结束前执行一次 `herdr agent prompt <parent-pane-id> "[WORKER_READY_FOR_ACCEPTANCE] ..."`。
3. worker 完成后该命令返回 `Error: Os { code: 1, kind: PermissionDenied, message: "Operation not permitted" }`。

## Context

本次并行研究要求 worker 主动提醒父 agent 开始 wait/get/read/验收。四个 worker 的通知都失败，增加了遗漏回收义务的风险。
