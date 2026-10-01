---
format: concord.document/v1
id: group-matrix-dedicated-component-ruling
title: GroupMatrix 走独立组件,否决扩展 MetricMatrix 的动态 Metric 方案(补记)
createdAt: 2026-07-23T18:20:41+08:00
createdAtSource:
  kind: first-recorded
  path: memory/group-matrix-dedicated-component-ruling.md
  commit: f1eee9a0a16583087bd4c0c7c6664a2726ea4536
kind: memory
memoryKind: decision
state: current
epoch: 0
promotions: []
history: []
---
# GroupMatrix 走独立组件,否决扩展 MetricMatrix 的动态 Metric 方案(补记)

裁决(2026-07-23,补记——这条裁决此前只存在于会话外记忆,未落 memory,现按定稿文档反推补上):
得分点 = 组(`t.group`)的下钻矩阵定为独立组件 `GroupMatrix`,不通过给 `MetricMatrix` 增加「动态
Metric / cell context」的方式扩展通用矩阵组件承载。

## 曾选方案

`docs/roadmap/report-chart-composition/` 一类比较里曾设想的另一条路:扩展通用 `Matrix` 组件,
让它支持「一个 attempt 贡献多个成员 + 传入 cell 计算所在的组上下文」,把组深度矩阵做成
`MetricMatrix` 的一个变体或选项。

## 否决理由

- **维度模型不匹配**:`MetricMatrix` 的 `Dimension` 是「一个 attempt → 一个 key」的一对一映射,
  `Metric.value()` 拿不到当前组上下文;而一个 attempt 可以同时贡献多个 `groupPath`(嵌套子树 +
  同一 attempt 内多个并列组),把组硬塞进 `Dimension` 会破坏「一 attempt 一 key」这条不变量。
- **格读法不是报告作者能配置的选项**:`MetricMatrix` 的格由用户传入任意 `Metric` 计算;
  `GroupMatrix` 的格读法是题型的固定语义——计分制读组子树内给分项挣分之和,通过制只读显式
  soft 断言(`.atLeast()` / `.soft()`)的无权均值(质量分),未链修饰符的断言缺省是 gate、不进入
  质量分。这条语义由折叠树规则(`docs/feature/experiments/score-points.md#折叠树判定面分数面质量分`)
  决定,不应该开放成 `cell: Metric` 参数。
- **组是 assertion/score-entry 的子实体,不是 Attempt 身份维度**:`MetricMatrix` 的行/列维度
  历来建立在 Attempt 的身份字段(eval、experiment、flag …)上;`groupPath` 是断言/给分记录内部的
  结构,把它伪装成一个新增的 `BuiltInDimension` 会污染通用矩阵的维度语义,也让「一 attempt 多组」
  这个真实情况在维度模型里表达不出来。

## 定稿形态

`GroupMatrix` 作为与 `MetricMatrix` 同层、不共享 `cell: Metric` 配置面的独立公开组件:

- 行 = eval × `groupPath`,按子树折叠(父组行汇总自身与全部后代组的证据,子组同时单独成行);
- 列 = experiment;
- 格读法随题型固定(计分制/通过制两套算法,见上「否决理由」);
- `refs` 只收对这个 `groupPath` 子树有过证据的 attempt,与 `MetricCell.refs` 跟随全覆盖范围刻意
  不同;
- 与 `MetricMatrix`/`MetricBars` 共用跨组件族原语(`makeDataComponent`、`MetricCellView` 等),
  但不复用其 `Dimension`/`cell: Metric` 配置面。

定稿依据:`docs/feature/experiments/score-points.md#得分点-组对比读取的下钻粒度`(折叠树与质量分
口径)、`docs/feature/reports/library/metric-views.md#groupmatrix`(组件契约,含「与 MetricMatrix
不同,GroupMatrix 不接收任意 Metric」的显式表述)。落地实现:`src/report/components/metric-views/
GroupMatrix.tsx`(web 面)、`compute.ts` 的 `groupMatrixData`(计算)、`faces.ts` 的
`groupMatrixText`(text 面),测试 `group-matrix.test.ts`;已接入内建报告
`src/report/built-in/standard.tsx`(`ExperimentComparison` 之后)。
