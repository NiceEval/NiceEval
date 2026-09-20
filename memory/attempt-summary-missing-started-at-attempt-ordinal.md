---
format: concord.document/v1
id: attempt-summary-missing-started-at-attempt-ordinal
title: attempt-summary-missing-started-at-attempt-ordinal
createdAt: 2026-07-19T16:44:26+08:00
createdAtSource:
  kind: first-recorded
  path: memory/attempt-summary-missing-started-at-attempt-ordinal.md
  commit: 4c248a67d8878a8e1b556ae81a23fc4011a1564e
description: AttemptSummaryData 携带 startedAt/identity.attempt 但 attemptSummaryText 两者都没渲染——已在 Phase H 修复
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
    statement: "# 已修(Phase H)"
    proof: []
    source:
      path: memory/attempt-summary-missing-started-at-attempt-ordinal.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:cb640fe74c40dfe84e647a9ecff824c28ef70731a0912f2027ab419771a0c746
---

# 已修(Phase H)

`attemptSummaryText`(`src/report/components/attempt-detail/faces.ts`)现在追加 `identity.attempt + 1`
(经新 locale 键 `attemptSummary.attempt`)与 `startedAt`(经 `formatReportDateTime`,未定义时不追加)。
web 面(`AttemptSummary.tsx`)在这条记之前已经渲染了这两个字段——重新核对代码才发现原描述"web 面同样
没渲染"已经不准确,只有 text 面缺。真机 dogfood(`niceeval show @<locator>`)确认首行现为
`attempt 1 · ✗ failed · Jul 18, 2026, 17:42`。测试登记在 `docs/engineering/testing/unit/reports.md`
「Attempt 参数化 page 与详情组件族」新增一行,实现在 `attempt-components.test.tsx`。

`attemptSummaryText`(`src/report/text/attempt-faces.ts`)只渲染 `data.locator`、`data.identity.evalId`、
`data.identity.experimentId`、verdict、`durationMs`、`costUSD`——`AttemptSummaryData` 上实际存在的
`startedAt`(何时跑的)与 `identity.attempt`(第几次重试)两个字段从未被读取,两面(text/web,web 面同样
没渲染)都看不到。

# Why 记这条而不是当场修

Phase E(`show @locator` 接线)审查这条时,一开始以为"locator 本身唯一,所以不需要单独显示 attempt
序号"——这个理由不成立:locator 解决的是**去重**(不会指向别的 attempt),不是**信息**(第几次重试、
什么时候跑的是独立事实,locator 不透明,读不出这两项)。真正站得住的理由是范围:`startedAt` 是
上下文元数据,不是判断"为什么失败"要看的证据,不属于 Phase E(接线 + 修复失败诊断链路可用性)的
必要范围,推迟不影响本次改动的正确性。

# How to apply

Phase H(docs/source-map/参考页同步)顺手把这个补上:
- `AttemptSummaryData`/`attemptSummaryData` 已经有这两个字段,不需要改计算层。
- 只需在 `attemptSummaryText` 追加一段(如 `data.startedAt` 存在时追加时间戳,`identity.attempt`
  非 0 或恒显示"attempt N"),web 面(`react/AttemptSummary.tsx`)对应加显示。
- 改之前check `docs/feature/reports/library/attempt-detail.md` 的 `AttemptSummary` 行是否需要跟着
  改措辞(当前只写"身份、verdict、开始时间、总耗时、成本"——「开始时间」已经在契约里,是实现没跟上,
  不是契约要新增)。
