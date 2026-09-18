---
format: concord.document/v1
id: experimentcomparison-relativeto-cosmetic-vs-groupby
title: experimentcomparison-relativeto-cosmetic-vs-groupby
createdAt: 2026-07-20T10:07:31+08:00
createdAtSource:
  kind: first-recorded
  path: memory/experimentcomparison-relativeto-cosmetic-vs-groupby.md
  commit: 447c23ac8687a6408aab1ea8b252c33aaa8e5ef7
description: ExperimentComparison/ExperimentList 的 relativeTo prop
  当天又被推翻,改成默认自动缩成最短唯一后缀(与 MetricScatter 点标签同一算法),不再需要报告作者手写路径前缀
kind: memory
memoryKind: decision
state: current
epoch: 0
promotions: []
history: []
---

**当前裁决(2026-07-20,同日第二次翻案)**：`ExperimentList`（因此 `ExperimentComparison`）不再有 `relativeTo` prop。行标签默认缩成 experiment id 在当前列表里的最短唯一后缀——末段唯一就只显示末段，撞名时逐段向前加长到能区分为止；算法与 `MetricScatter` 散点点标签共用同一份实现（`shortestUniqueLabels`，`src/report/model/format.ts`），两处保证同一份 id 缩成同一个显示名。完整 id 不受影响，仍是排序 / 过滤 / 折叠展开的身份键。契约见 `docs/feature/reports/library/entity-lists.md`「`ExperimentList`」与 `docs/feature/reports/library/summaries.md`「`ExperimentComparison`」。

**曾选方案（同日先落地又推翻）**：给 `ExperimentComparison` 加显式 `relativeTo?: string`，原样透传给 `ExperimentList`（提交 `447c23a`）。**推翻理由**：用户当场反馈"这个需要指定名字"——要求报告作者手写字面量前缀（如 `relativeTo="compare"`）本身就是多余的心智负担，且这个前缀会在目录改名时静默失效（不报错，只是不再缩短）。而 `MetricScatter.pointLabels`（现已提取共享）早就证明了同一类 id 可以在不要求作者指定任何参数的前提下自动缩到最短唯一后缀、撞名时自动加长——这是已经上线、有测试覆盖的既有能力，只是此前没有复用到 `ExperimentList`，导致同一份 experiment id 在散点里已经缩短、在列表里却还是完整路径，报告内部不一致。

**为什么这次真的不是 [[reports-external-review-rulings]] 否决的 `groupBy`**：`groupBy` 引入组边界、组选择器/组索引，改变「一份 Scope 只有一份摘要/散点/列表」的不变量；自动缩短显示名不引入任何分组 UI，不改变数据结构，完整 id 全程保留为排序/过滤/身份键，纯粹是展示层的字符串收窄——甚至比被否决的显式 `relativeTo` 更彻底地贯彻了「不给零配置组件加旋钮」的原则（不但没加旋钮，还去掉了刚加的那一个）。

**教训（更新)**：evaluate "给报告作者一个显式配置项" vs "组件自己把这件事做对不需要配置" 时,如果算法本身可以做到零配置且不产生歧义（本例：唯一后缀 + 撞名自动加长，没有"猜错"的可能，因为撞名时保证升级到能区分),优先选零配置。只有当自动结果无法满足某个具体场景(例如作者想要一个与"唯一性"无关的、更短或更符合语义的自定义前缀)时才值得考虑显式 prop——而这次没有出现这样的场景,所以不需要保留 relativeTo 作为"高级选项"。

关联：[[reports-external-review-rulings]]（`groupBy` 否决的原始记录）、[[default-report-partitions-experiment-groups]]（路径不做分组的设计基础）。
