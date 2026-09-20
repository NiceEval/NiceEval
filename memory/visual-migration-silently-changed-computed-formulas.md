---
format: concord.document/v1
id: visual-migration-silently-changed-computed-formulas
title: visual-migration-silently-changed-computed-formulas
createdAt: 2026-07-11T22:34:32+08:00
createdAtSource:
  kind: first-recorded
  path: memory/visual-migration-silently-changed-computed-formulas.md
  commit: f98713aea9dc23b459ffa428b5cb32c56b438a4a
description: 已修 — 视觉层重构把裸跑 UI 迁进 defaultReport 时未建行为矩阵,静默改了通过率/失败原因/组统计三处公式
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
    statement: 已修 — 视觉层重构把裸跑 UI 迁进 defaultReport 时未建行为矩阵,静默改了通过率/失败原因/组统计三处公式
    proof: []
    source:
      path: memory/visual-migration-silently-changed-computed-formulas.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:aad2db43874025e733689b9c1a07bbfd96bbf2d3793ff6dcea220450605708fa
---

## 现象

`d0b6718`(2026-07-10)把手写的 `niceeval view` 裸跑首页迁移成通用双面 `ReportDefinition`
(`defaultReport`)后,以下三处公式/语义在迁移前后不一致,但代码照常编译、页面照常渲染出
看似合理的内容,没有报错也没有明显的视觉破损:

1. **RunOverview 头部通过率**:旧页头显示的是 `computeCell(passRate, allItems)`——按 eval×snapshot
   分桶、桶内先算 attempt 级均值(`perEval`)、再跨桶算均值(`across`)的两级聚合,天然带 partial
   credit(一个 eval 3 次 attempt 过 2 次贡献 0.667,不是二元票)。迁移后的新头部改成了从
   `passed/failed/errored` 四个 attempt 级原始计票现场算 `passed / total` 的朴素比例,两个 eval
   attempt 数不同或存在 partial credit 时,两个公式给出不同的数字。
2. **展开行失败原因**:旧 `reasonFor`(`src/view/app/lib/verdict.ts`)优先级是
   `error → skipReason → 所有未通过的 gate 断言(保持声明顺序,soft 断言排除在外)`,多条 gate
   断言全部保留、用统一分隔符拼接。迁移后的新实现变成"断言优先、error 兜底"且只挑第一条
   `!a.passed`(不分 gate/soft),`skipReason` 从未被检查,多条失败 gate 断言只剩第一条。
3. **组汇总数字整个消失**:旧 `GroupSelector` 每个实验组卡片上的通过率(`evalPassRate`,eval 级
   折叠计票,不含 skipped 分母)、`N results, F failed[, E errored], total-cost`、最后运行时间,
   在新结构里没有对应组件,信息直接丢失,不是显示错误而是彻底不存在。

同一次迁移里还有一处**架构改进**、不应被后续复盘误当成回归:旧 `GroupSelector` 是"选中态"模型,
非当前选中的组和所有无 `/` 前缀的无分组实验永远不可见;新结构里所有组与无分组实验同时渲染,这是
有意为之的修复,不是漂移。

## 根因

视觉/结构迁移动手前没有先列一张"旧公式 vs 新公式,逐项对照"的行为矩阵或锁定期望数字的
fixture 测试——迁移的驱动目标是"把散落的 React 组件收进 `ReportDefinition` 树,让 `show`/`view`
共用同一份定义",这个目标本身不涉及公式,但重写渲染代码时,新的双面组件(web/text face)把
"从原始数据现场推导比例"的逻辑写进了渲染层本身,而不是让计算层(`compute.ts`)预先算好唯一
正确的值、渲染层只管展示。一旦渲染层可以自己重新计算,任何两处渲染面(web 与 text)、任何两次
重构前后的实现,都可能各自长出一份看起来合理但实际不同的公式,而这种偏差不会被类型检查、
lint 或"页面还能渲染"这类粗粒度信号捕捉到——它只在数字比对时才会暴露。

## 修法

本次任务(`TODO.md` 全文)按下列变更收敛:

- `src/report/default-report-definition.tsx` 更名为 `src/report/default-report.tsx`(裸跑填充物,
  小写 `defaultReport: ReportDefinition`);原 `src/report/default-report.tsx` 更名为
  `src/report/official-report.tsx`(零 props 双面组件 `<DefaultReport />`)。
- `OverviewData.totals` 新增 `passRate: MetricCell`,由 `compute.ts` 的 `overviewData()` 调用
  `computeCell(passRate, items)` 算出;`passed/failed/errored/skipped` 四个 attempt 级原始计票
  保留(它们是 `RunOverview` 独立的 verdict-count 展示,不是 passRate 的输入),`RunOverview` 的
  web/text 两面只渲染 `data.totals.passRate.display`,不再现场推导。
- 在 `compute.ts` 提炼公开纯函数 `failingGateAssertions()` / `reasonFor()`(优先级
  `error → skipReason → 未通过的 gate 断言,保持声明顺序,soft 断言永不进入`),`MetricTable`
  展开子行、`CaseList.data`、`official-report.tsx` 的 `buildBoard()` 三处共用,不再各写一份
  `.find(a => !a.passed)`(细节见 [[reasonfor-priority-and-severity-bug]])。
- 新增 `GroupSummaryData` 契约与 `GroupSummary` 双面组件,底层复用 `summarizeItems()`
  (experiment/eval/attempt 数、eval 级折叠计票、null-safe 总成本、最后运行时间的同一套实现),
  `experimentRowMeta()` 的 `verdicts` 列同样改调这个共用函数,消灭原来两处重复的
  `evalLevelStats(...)` 拼装。`GroupSummaryData.passRate` 由 `groupSummaryData()` 在
  `summarizeItems()` 的折叠计票之上另算 `passed / (passed+failed+errored)`,口径是旧
  `GroupSelector` 卡片的 `evalPassRate`(eval 折叠投票),刻意不是 `computeCell`——
  与 `OverviewData.totals.passRate` 是两个不同公式,`summarizeItems()` 本身不产出任何比率。

一般性教训(供以后做"视觉层重构同时touch了计算层"的场景对照):动手组件化之前,先冻结一张
"旧公式 vs 新公式"的字面对照表,或者更好——写一个 fixture 驱动、断言精确期望数字的测试,
在改视觉结构之前跑一遍确认它能复现"旧代码给出正确答案"。并把"渲染面只展示预计算好的值,
绝不在 web/text face 内部重新推导比例或聚合值"当成结构性不变量长期遵守——`TODO.md` 的
"不可变设计"清单里已经把它写成一句话:「web face 和 text face 只展示已经算好的数据,不现场
推导通过率、Verdict、成本或失败原因」,后续任何报告相关重构都应该先读这条再动手。

## 适用场景

任何"把手写 UI 迁移成通用/声明式组件框架"的重构,只要迁移路径同时经过一层会做聚合计算的
数据层(通过率、平均值、计票之类),都要假设公式漂移是默认结果而不是意外——组件化本身不会
自动保证数值口径不变,必须显式用回归测试或对照表锁定。
