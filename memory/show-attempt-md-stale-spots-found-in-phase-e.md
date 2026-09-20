---
format: concord.document/v1
id: show-attempt-md-stale-spots-found-in-phase-e
title: show-attempt-md-stale-spots-found-in-phase-e
createdAt: 2026-07-19T16:44:26+08:00
createdAtSource:
  kind: first-recorded
  path: memory/show-attempt-md-stale-spots-found-in-phase-e.md
  commit: 4c248a67d8878a8e1b556ae81a23fc4011a1564e
description: Phase H 待办清单——docs/feature/reports/show/attempt.md 里三处仍是旧 attemptOverviewText 时代的叙述,与新 AttemptDetail 组件族实际输出不符
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
    statement: "# 已修(2026-07-24 复核)"
    proof: []
    source:
      path: memory/show-attempt-md-stale-spots-found-in-phase-e.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:96b6b2ae72d1cb86d325d24ca15e4153a090bcaf0e3345c7cc80bd67d7cea8d9
---

Phase E(`show @locator` 接线到 `standardAttemptPage`,删除旧 `attemptOverviewText`)过程中,对照
`docs/feature/reports/show/attempt.md` 逐句核对新输出时,发现这篇文档"半迁移":组件名已经改成新的
(`AttemptSummary`/`AttemptAssessment`/`AttemptSource`/`AttemptAssertions`),但至少三处内容其实是照抄
旧 `attemptOverviewText` 的行为,与新组件族的实际渲染对不上:

1. **代码示例整块是旧 renderer 的输出**:文档里 `niceeval show @1qrdcfq8` 的示例输出——两行头
   (`@locator · eval · exp · verdict` 换行 `snapshot ... · attempt N · ...`)、`assertions: 3 passed ·
   1 gate failed` 摘要行、`artifacts:`/`available:` 尾块——都是已删除的 `attemptOverviewText`
   (`src/show/render.ts`)逐字段产出的,不是新组件族会渲染的样子。
2. **"按结果分节列断言"的四段式描述是照抄 `failureDiagnostics`**(同样已删除):`failures:`/
   `soft below threshold:`/`scores:`/`unavailable:` 四个带标签的分节,是旧 `attemptOverviewText`
   的行为;新 `AttemptAssertions`/`AttemptSource` 是扁平列表(非 passed 逐条 + passed 按 group 折叠
   计数),severity 内嵌在每行里,不分四段。
3. **"为保持一行可读只列耗时可见的大头"的 timing 过滤规则是为旧单行格式服务的**:旧
   `overviewTimingLine` 把所有主链阶段拼成一行,所以要过滤掉 `workspace.baseline`/`telemetry.*`
   这类极短阶段;新 `AttemptTimeline` 是逐阶段一行的多行块,没有单行宽度约束,这条过滤规则不该
   照搬——`show/show.test.ts` 已按"全部阶段都显示"重写(2026-07-19)。

# Why 记录而不是当场改

Advisor 复核时确认:这三处只活在 `show/attempt.md` 的散文里,**没有一处被
`docs/engineering/testing/unit/reports.md` 登记**(cases.md 第 256 行的 AttemptTimeline 场景只
要求 children 折叠、失败节点标记默认展开,不要求过滤短阶段)。cases.md 是绑定测试的权威来源,
show/attempt.md 是给用户看的任务文档——按 CLAUDE.md 的"先文档后代码",理应文档先定稿再实现,但这
篇文档显然是先写死了旧实现的输出样例,新实现从未回头核对。当场按这三处重写整篇文档超出 Phase E
(接线 + 修复失败诊断链路可用性)的范围,留给 Phase H(docs/source-map/参考页同步)一次性处理。

# How to apply

Phase H 重写 `docs/feature/reports/show/attempt.md` 时:
- 代码示例整段替换成真实调用 `standardAttemptPage` 产出的文本(可以复用 Phase E 走查时构造的
  fixture 手法:`/private/tmp/.../scratchpad/render-attempt-page.ts` 的思路,构造 source 可用 /
  不可用 / errored 三条分支,分别贴真实输出)。
- 断言分节描述改成扁平列表 + severity 内嵌 + `source: file:line:col` 锚点(与 `assertionLine()`
  实际输出一致);不要保留"failures:/soft below threshold:/scores:/unavailable:"四段式措辞。
- timing 段落删掉"为保持一行可读只列大头"的过滤规则描述,改成"逐阶段一行,收尾段单独归拢在
  teardown: 下,--timing 才是完整展开(含 children)"。
- 同时核对 `docs/feature/reports/show.md` 有没有引用同一套旧措辞(未逐句核对,Phase H 一并查)。

关联:[attempt-detail-component-level-green-composite-broken](attempt-detail-component-level-green-composite-broken.md)(同一轮走查发现的组件实现缺陷,那条是代码要修,这条是文档要改)。

# 已修(2026-07-24 复核)

Phase H 已按上面三条重写 `docs/feature/reports/show/attempt.md`:判据是 `attemptOverviewText`
与 `failureDiagnostics` 两个旧 renderer 名在 `docs/feature/reports/show/` 全目录零命中——三处陈旧
叙述都是照抄这两个已删除函数的输出,名字消失即叙述已换。
