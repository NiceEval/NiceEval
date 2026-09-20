---
format: concord.document/v1
id: incomplete-summary-hides-unstarted
title: INCOMPLETE 结论隐藏 unstarted
createdAt: 2026-08-03T18:10:08+08:00
createdAtSource:
  kind: first-recorded
  path: memory/incomplete-summary-hides-unstarted.md
  commit: 1d5d3eddf9bcf3994fdefb0de6deade21b62a02b
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
    statement: "- 已修 [incomplete-summary-hides-unstarted](incomplete-summary-hides-unstarted.md) — 止损闸后 human 结论只显示 `INCOMPLETE`、隐藏 `completion.unstarted`，计划与 verdict 平白少数；修为结论行显式列 `N unstarted`，保持「未执行」身份不冒充 skipped"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---
# INCOMPLETE 结论隐藏 unstarted

## 现象

2026-08-03 在 MemoryBench 的 `compare/codex` 运行中，Nowledge 共享服务探针触发
`dispatch-halted`。计划共 108 条，结论只列出 91 passed、9 failed、1 errored，标题为
`INCOMPLETE`；未派发的 7 条既没有数量，也没有身份词，操作者只能手算差值，并容易误以为
它们应当是没显示理由的 `skipped`。

## 根因

Runner 与 `assembleInvocationCompletion` 已经正确把止损闸拦下的数量记入
`InvocationCompletion.unstarted`，JSON 结果也会输出它；但 human summary 只渲染 verdict 与
reused 计数，没有消费 `completion.unstarted`。标题会因 completion 变成 `INCOMPLETE`，正文却
丢了导致 incomplete 的规模。

## 修法与范围

human renderer 在 `completion.unstarted > 0` 时选用带 `unstarted` 的结论行；数量保持
`unstarted` 身份，不改判为 `skipped`，因为这些 Attempt 从未执行、没有 Verdict。单元测覆盖
incomplete 且数量非零的结论行；完整终端字节另由 CLI E2E 负责。
