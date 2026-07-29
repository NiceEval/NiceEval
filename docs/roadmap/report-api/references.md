# 报告作者 API —— References

本篇记录候选 API 从外部产品学习什么，以及哪些部分不适合 NiceEval。
当前 Reports 已有逐块参考见
[Reports · 参考方案](../../feature/reports/reference/README.md)；
这里专门比较普通报告作者的完整开发体验。

## Rill：指标层到默认分析页

[Rill Metrics View](https://docs.rilldata.com/developers/build/metrics-view/what-are-metrics-views)
集中定义维度与指标；Explore Dashboard 从一份 Metrics View 自动产生可筛选、可下钻的默认分析面；
[Canvas Dashboard](https://docs.rilldata.com/developers/build/dashboards/canvas)
允许从多个 Metrics View 组合自定义页面。

候选 API 学三点：

- 指标和维度由数据层维护，报告作者只选择名字。
- 一份数据定义应自动得到有用默认页，不要求先声明所有组件。
- 默认 Explore 与自定义 Canvas 是渐进路径，不是两套数据词表。

不跟 YAML 组件树。完整 Dashboard YAML 适合作为交换格式，
但 TypeScript 报告可以用字面量类型、函数复用和 JSX 获得更短的长期作者面。

## Evidence：命名数据直接交给组件

[Evidence](https://docs.evidence.dev/) 在 Markdown 中声明命名 SQL，
组件统一通过 `data={queryName}` 消费结果。
页面文字、查询和图表处在同一个阅读上下文。

候选 API 学一条：一次计算得到的结果应能直接复用于图、表与叙事。
NiceEval 不照抄 `data` 属性；组件按值的角色分别接收 rows、points、items 或 value。

不跟 SQL。NiceEval 的官方指标必须保住两级聚合、覆盖和 Attempt 引用；
这些规则不能退回每份报告的 `group by` 与附加列。

## Observable Framework：惰性依赖与开发循环

[Observable Framework Data Loaders](https://observablehq.com/framework/data-loaders)
在构建阶段生成静态数据快照，按页面引用执行并缓存。
预览服务器在 loader 变化后重新运行并更新页面。

候选 API 学三点：

- 作者声明依赖，框架负责发现、执行、缓存与错误传播。
- 数据在进入浏览器前成为静态快照。
- 开发预览应显示 loader 状态、缓存和失败，而不是只显示最终组件错误。

不跟多语言 loader。NiceEval 输入是 Sample 与 Attempt Evidence，
普通报告直接调用 TypeScript 转换函数。

## Malloy：Source 上的可复用字段与 View

[Malloy Sources](https://docs.malloydata.dev/documentation/language/source)
把维度、指标、关联和可复用 View 挂在 Source 上；
查询只选择已有字段并追加局部细化。

候选 API 学一条：聚合结果字段应从分组函数与官方读数函数推导，
使下游组件获得补全。

不跟新的查询语言，也不跟字符串字段选择。
NiceEval 已经以 TypeScript 写 Eval、配置与报告，
作者把官方函数值交给 `aggregate()` 即可。

## Lightdash：内容依赖与字段演进

[Lightdash Metrics](https://docs.lightdash.com/references/metrics)
在语义层定义指标，并允许下钻查看底层值；
[Dashboards as Code](https://docs.lightdash.com/guides/developer/dashboards-as-code)
把图表和 Dashboard 保存成代码。

候选 API 学两点：

- 指标重命名或删除时，应列出受影响报告并提供可定位错误。
- 数据字段的说明、单位、下钻能力和使用位置都应可发现。

不把完整可视化状态直接作为首选作者格式。
大量编辑器状态进入文件后，人工阅读和 Agent 修改都会变差。

## Cube：消费端无关的语义层

[Cube Data Modeling](https://docs.cube.dev/docs/introduction)
把指标、维度、关联与访问规则定义在消费端之前，
再通过多种 API 提供给 BI、嵌入应用与 Agent。

候选 API 学一条：官方指标目录不属于某个图表。
终端、网页、自有 React 页面和 Agent 都应消费同一份指标身份与计算结果。

不把 NiceEval 扩成通用语义层服务。
它的事实来源仍是 Record，比较边界仍由 Sample 确定。

## Braintrust：把通用监控与实验比较分开

[Braintrust Monitor](https://www.braintrust.dev/docs/observe/dashboards)
的图表编辑器不是围绕数据实体设计，而是围绕一个稳定的小组合：

```text
图形
  + measure / aggregator
  + trace filter
  + span filter
  + group by
  + unit / interval / sort
```

图形只有 time series、top list 与 big number 等任务级形状。
measure 可从字段与 `sum`、`avg`、`min`、`max`、`count`、
`count distinct`、`percentile` 组合，也允许完整 SQL 聚合表达式。
页面级过滤和分组影响全部图表；点击任一数据点会带着时间范围和 series
进入相应 Logs 或 Experiments 页面。

候选 API 学五点：

1. 图形、计算、选择范围和显示格式是四个正交问题。
   `Scatter` / `Bars` 不应知道 `passRate`，Calculation 也不应知道图形。
2. 必须区分“选择整个比较单位”和“只让部分观测参与计算”。
   Braintrust 分开 trace filter 与 span filter；
   NiceEval 分开 `sample.scope()` 与 `sample.filter()`。
3. 常用路径应有官方 Calculation，长尾路径使用同一公开组合器。
   Braintrust 的 SQL 表达式逃生口对应 NiceEval 的 `rollup()`，
   不是 `defineMeasure()` 或内部 Source。
4. 每个聚合点都应该能下钻到构成它的原始证据。
   NiceEval 的 `MetricValue.refs` 比重跑一个过滤查询更严格：
   它还必须保留缺值与 coverage 的解释。
5. 结果和配置都应可检查、复制和导出。
   NiceEval 不必复制远端 View API，但开发模式应能查看组件收到的 rows、
   MetricValue 元数据与 refs，而不是只能看最终图。

Braintrust 也暴露了一个不应复制的坑：
部分内建 preset 会自动排除 scorer spans，而自定义图默认包含它们。
这意味着看起来相同的官方图和用户图可能因为隐藏过滤不同而得出不同值。
NiceEval 必须让官方 Calculation 与用户 Calculation 都走公开的
`rollup()` / `aggregate()`，默认排除规则则进入 Sample 或显式函数，
不能藏在内建报告里。

[Braintrust SQL](https://www.braintrust.dev/docs/reference/sql/query-structure)
区分 spans、traces 与已聚合 summary，并在严格模式拒绝继续对 summary
做 `GROUP BY`。这支持 NiceEval 给计算粒度加类型边界：
`aggregate()` 接 Sample，返回的 AggregateRow 只是结果，
不能再被当成 Sample 送回 `aggregate()`。

它也说明 `pivot` 的位置：Braintrust 把 PIVOT / UNPIVOT 放在高级 SQL
结果整形层，而不是 Dashboard 图表原语。
NiceEval 没有通用查询语言，因此矩阵整形留给普通 JavaScript
或矩阵组件旁的 `toMatrixRows()`，不进入计算核心。

### 对 delta 与 stability 的直接启示

[Braintrust Experiment Comparison](https://www.braintrust.dev/docs/evaluate/compare-experiments)
没有把 delta 当作 Monitor 的任意 measure。
它先选择 baseline，再用 comparison key 对齐测试用例，
然后才产生逐行 delta、improvement 与 regression。
SDK 也通过带 baseline 的 experiment `summarize()` 返回比较摘要。

这支持候选设计：

- `history` 是输入集合和时间 / Run 分组，不是计算函数；
- `delta` 是需要 baseline、配对键与缺失策略的比较算法，
  留在比较报告旁的 `pairedDelta()`；
- `stability` 在 Braintrust 中表现为按 input 折叠 trials 后观察不一致，
  仍不是一个跨场景固定公式；
- `frontier` 没出现在通用 Dashboard 模型里，只可能是某张质量—成本图的局部标注。

Braintrust 的 reducer 目录还暴露了一个缺口，但不能原样照搬。
NiceEval 在 `mean`、`sum`、`min` 与 `max` 之外加入 `percentile(p)`，
让耗时尾部读数显式声明题内和跨题两个阶段。
通用 `count` 与 `countDistinct` 不加入：在 NiceEval 中，
“数 Attempt”“数 Eval”和“跨 Eval 去重”不是同一种操作，
分别由具名 Calculation 或报告旁函数表达。

## Metabase React SDK：嵌入边界

[Metabase Modular Embedding SDK](https://www.metabase.com/docs/latest/embedding/sdk/quickstart)
用 Provider 和 React 组件把图表或 Dashboard 放进产品页面。

候选 API 学一条：嵌入包应以宿主 React 应用为中心，
提供纯组件、主题和明确事件，不要求宿主加载完整报告运行时。

NiceEval 不需要远端 BI 服务、认证会话或保存查询 id。
服务端先把 Record 解析成快照，浏览器组件只渲染这份快照。

## 对 NiceEval 的综合结论

没有一个参考物同时提供：

- 领域化官方指标；
- 聚合值到 Attempt Evidence 的完整引用；
- 同一声明的终端与网页两面；
- 静态导出和自有 React 嵌入；
- TypeScript 报告作者面。

因此候选 API 不复制某个产品的表面语法。
它组合 Rill 的官方指标治理、Evidence 的结果复用、
Malloy 的字段推导和 Braintrust 的证据下钻。
Observable Framework 的快照边界保留在交付层，不进入作者 API；
作者面始终是普通 TypeScript 值与函数。
