---
format: concord.document/v1
id: attempt-detail-component-level-green-composite-broken
title: attempt-detail-component-level-green-composite-broken
createdAt: 2026-07-19T16:44:26+08:00
createdAtSource:
  kind: first-recorded
  path: memory/attempt-detail-component-level-green-composite-broken.md
  commit: 4c248a67d8878a8e1b556ae81a23fc4011a1564e
description: 已修——11 个叶子组件的渲染矩阵全绿,但拼成 AttemptDetail 整页后两处功能性缺陷(下钻命令丢 locator、断言缺源码锚)只有渲染完整合成页才能看见
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
    statement: 已修——11 个叶子组件的渲染矩阵全绿,但拼成 AttemptDetail 整页后两处功能性缺陷(下钻命令丢 locator、断言缺源码锚)只有渲染完整合成页才能看见
    proof: []
    source:
      path: memory/attempt-detail-component-level-green-composite-broken.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:cc81257a419ae915bde5ce048626617edd1f3ae6484590f8559364b9526f0252
---

Phase C 给 11 个叶子组件写了渲染矩阵测试(见 [render-matrix-not-just-data-matrix](render-matrix-not-just-data-matrix.md)),
逐组件验证两态两面都真正渲染、含标志字段。全绿。但 Phase E 接线 `show @locator` 前,advisor 建议先把
`standardAttemptPage`(11 个叶子拼成的整页)真正渲染一次再读——渲染后发现两处**逐组件测试测不出来**的缺陷:

1. **五个证据组件(`AttemptSource`/`AttemptTimeline`/`AttemptConversation`/`AttemptTrace`/`AttemptDiff`)的
   下钻命令丢了 locator**:text 面硬编码 `niceeval show --source` 这类裸命令,不可执行(缺 `@<locator>`)。
   根因:这 5 个 `Attempt*Data` 类型当初没带 `locator` 字段,text 面也没用 `ctx.attemptCommand` 通道
   (`TraceWaterfall` 已有这套注入模式,新组件没抄)。逐组件渲染矩阵测试只断言"含标志字段",不检查命令
   本身能不能跑,所以这处彻底不可执行的命令从未被测出来。
2. **`AttemptAssertions`/`AttemptSource` 的失败断言原来不带源码锚**:`assertionLine()` 只显示
   expected/received,没有用 `AssertionResult.loc`(断言在 eval 源码里的调用点,独立于整份源码是否被
   捕获)拼 `file:line:col`。docs/engineering/testing/unit/reports.md 第 255 行明确要求"提供源码锚",
   逐组件测试(见上条 memory)第一版只测了 data 层返回的 `expected`/`received` 字段本身,没有对着这行
   注册表场景逐句核对"源码锚"这个词。

# 根因(为什么组件级测试测不出来)

两处缺陷都是**跨组件/跨层的上下文缺失**,不是单个组件内部逻辑错:
- 命令缺 locator 是因为 data 类型本身没带这个字段——组件自己的渲染逻辑是对的,喂给它的 data 从源头
  就缺东西,逐组件测试用的 fixture 也没构造"如果被拼进真实报告会经过 ctx.attemptCommand 通道"这个
  上下文,所以测不出来。
- 断言缺源码锚是因为实现时只对照了 `attempt-detail.md` 的组件级契约表格,没有逐句对照
  `cases.md` 已登记的场景行原文(那行明确写了"源码锚"三个字)。

这与 `view-attempt-detail-buries-failure` 是同一类问题的变体:组件契约本身没错,是**组合/接线层面**
的东西(view 那次是排列顺序,这次是跨组件共享的下钻命令通道与断言字段完整性)没有被组件级测试覆盖到。

# 修法

- `src/report/types.ts`:给 `AttemptSourceData`/`AttemptTimelineData`/`AttemptConversationData`/
  `AttemptTraceData`/`AttemptDiffData` 都加 `locator: AttemptLocator` 字段。
- `src/report/attempt-compute.ts`:对应 5 个 `attempt*Data()` 函数填 `locator: evidence.locator`。
- `src/report/text/attempt-faces.ts`:新增 `evidenceCommand(ctx, locator, flag)` 小helper(复用
  `ctx.attemptCommand` 通道,没有时优雅退化成不生成命令,不造假命令,与 `traceWaterfallText` 同一套
  退化规则),5 个证据组件的 text 面都改用它。
- `assertionLine()` 加 `a.outcome === "failed" && a.loc` 时追加 `source: file:line:col`;
  `attemptSourceText` 相应简化(不再自己拼锚点,统一交给 `assertionLine`)。

# 如何再次验证这类问题(方法论,不只是这次的两个 bug)

组件级渲染矩阵测试对"零输出/非空态各含标志字段"这类局部性质是够用的,但对**跨组件共享的东西**
(下钻命令、page 级排列顺序、identity 完整性)测不出来——那些只在**拼成整页**渲染时才会现形。
Phase E 接线前先用一次性脚本(不进仓库,`/private/tmp/.../scratchpad/`)对着 `standardAttemptPage`
构造三种典型证据(source 可用/不可用、errored 无断言)分别渲染并通读,再据此裁定测试该断言什么——
不要反过来从组件产出反推断言(那样会把偶然的实现细节焊死成"契约")。这个「先渲染整页判断、再写测试」
的顺序本身也值得记:写测试前没有看过完整聚合输出,就没有资格宣称组件族"够好"。
