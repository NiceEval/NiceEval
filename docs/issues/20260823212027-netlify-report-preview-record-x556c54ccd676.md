---
format: concord.document/v1
id: 20260823212027-netlify-report-preview-record-x556c54ccd676
title: Netlify report preview 仍消费 MemoryBench 的旧 Record
createdAt: 2026-08-23T21:20:27+08:00
kind: issue
state: draft
memoryRelations: []
adoptions:
  current: []
  history: []
origin:
  kind: dev
  repository: NiceEval/NiceEval
  commit: c7c37b3a47b9bec75bf5dd24d864c661cde92a65
subject: repository
claim: defect
observation: 在当前 main 契约上执行 `CONTEXT=deploy-preview bash netlify-preview/build-report-preview.sh`，MemoryBench `2-0` 安装当前 NiceEval candidate 后，`niceeval view --out` 返回 `record-format-unsupported`，并提示使用写入该 future or unknown Record format 的 NiceEval 版本。
impact: 任何真实触及 Record reader、report、view 或 CLI 的 PR 都会在 Netlify report preview 阶段失败，直到预览 fixture 由当前 Record producer 重新生成。
history:
  - at: 2026-09-14T15:00:25.173Z
    action: migrate
    reason: Transferred the existing observation to its current Issue owner.
    source:
      path: feedback/20260823212027-netlify-report-preview-旧-record/README.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:4b5958082e2147e2c23d02e7707fadf426940bd9fc9e7ce71ac3e37af000d0a5
---
# Netlify report preview 仍消费 MemoryBench 的旧 Record

## Reproduction

```sh
CONTEXT=deploy-preview bash netlify-preview/build-report-preview.sh
```

脚本克隆 MemoryBench `2-0`、安装当前 NiceEval candidate，然后在 `niceeval view --out` 返回 `record-format-unsupported`。

## Scope

当前修正只让与 report preview 消费边界无关的 PR 跳过该任务。涉及 Record reader、report、view 或 CLI 的变更仍会运行预览并暴露这个问题；要恢复这些变更的绿灯，需要用当前 producer 重新生成可公开消费的 fixture。
