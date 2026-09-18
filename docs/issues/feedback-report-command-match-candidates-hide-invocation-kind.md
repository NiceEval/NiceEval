---
format: concord.document/v1
id: feedback-report-command-match-candidates-hide-invocation-kind
title: Report 的命令匹配候选隐藏实际调用身份
createdAt: 2026-08-24T14:08:40+08:00
kind: issue
state: draft
memoryRelations:
  - kind: root-cause
    memory: memory/report-tool-match-candidates-hide-human-evidence.md
adoptions:
  current:
    - docs/feature/assertions/library/display.md#单条-assertion
  history: []
origin:
  kind: dev
  repository: NiceEval/NiceEval
  commit: c1497f7b7059e558cbf34c4ac1f93a964f505eea
subject: product
claim: defect
observation: commandMatch 的候选树把所有被检查的 tool occurrence 都显示成 `调用 N`。真实画面中的 `调用 1` 实际是普通工具 `lookup_fixture`，`调用 2` 才是命令 `node --version`；字段行仍显示英文 `command`、`status`。
impact: 读者无法知道序号对应哪次实际调用，也无法分辨普通工具候选与命令候选，必须跳到完整轨迹并靠位置反推 matcher 为什么命中。
history:
  - at: 2026-09-14T15:00:25.173Z
    action: migrate
    reason: Transferred the existing observation to its current Issue owner.
    source:
      path: feedback/feedback-report-command-match-candidates-hide-invocation-kind/README.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:6fc72564a105898d8c741f5867cc852a132301df36c97da286e41da44670f81d
---
# Report 的命令匹配候选隐藏实际调用身份

用户在真实 Report 中观察到：commandMatch 将普通工具与命令候选统一显示成无语义的 `调用 N`，无法知道每个序号对应哪次实际 invocation。

## 仍缺的产品能力

候选标题改为工具名或命令 preview，只修复了单个 retained diagnostic 的可读性。Report 仍缺完整 source-owned ledger、`toolOccurrenceId`／`eventId` 与 scope relation、coverage-aware overlay、精确过滤和“定位到会话日志”。它也没有为 `toolOrder`／`eventOrder` 交付 witness path 或 `failure frontier`，因此这条 Feedback 保持 open。
