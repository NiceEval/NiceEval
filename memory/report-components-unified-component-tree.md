# report-components-unified-component-tree

## 裁决

2026-07-25(用户定案):报告组件库整体统一为**组件树**——数据绑定与局部配置写成结构子节点，不再用扁平 options + 数组 prop + `Record` 侧表。落点是新目录 `docs/feature/reports/components/`(README 总纲 + charts / tables / entity-lists / summaries / attempt-detail / site / gallery)，原 `docs/feature/reports/library/{metric-views,entity-lists,summaries,attempt-detail,site-components}.md` 整体收编，`library/` 只留 metrics、layout、shell、theme、recipes、built-in。

逐组件形态:

- 图表族 `LineChart` / `BarChart` / `AreaChart` / `ScatterChart` / `ComposedChart` + `XAxis` / `YAxis` / `Line` / `Bar` / `Area` / `Scatter` + `ErrorBar` / `LabelList` / `Cell` / `Label`，**取代** `MetricLine` / `MetricBars` / `MetricScatter`(这三个名字连同 `connect` / `series` prop 一起从契约里消失，散点的 `connect` → `Scatter line`，`series` → `by`)。
- `MetricTable` 收 `<Rows>` / `<Column>`；`MetricMatrix` 收 `<Rows>` / `<Columns>` / `<Cells>`；`Table` 排版原语的 `columns` 数组也改成 `<Column>` 子节点(列是声明、行是数据)。
- `Scoreboard` 收 `<Subject>` / `<Question>`，一并**删掉** `subject: (evalId) => string` 函数与 `weights: Record<前缀, 权重>` 侧表——权重挂在题目或分科条目上，题多时用 JSX `map` 展开。
- `DeltaTable` 收 `<Columns dimension>` → `<Condition value baseline>` / `<FlagConditions flag>`，取代 `by` + `conditions` 数组 + `conditionsByFlag()`；基准从「数组第一个」改成显式 `baseline` 属性。
- `StabilityMatrix` 只收 `<Columns>`(行恒为 eval)。

## 否决的两条

- **实体列表开放选列**(`<ExperimentList><Column field="model" /></ExperimentList>`):否决。理由写进 `components/entity-lists.md`「为什么实体列表不开放列」——主读数列由题型构成自动切换，开放选列等于要求作者维护那个分支；且 `MetricTable` 已经是「自由选列」的那个组件，两个都开放会塌成一个，实体列表独有的三级展开、占位行与时效标注被稀释成表格的一种配置。
- **组合组件用子节点覆盖默认装配**(`<AttemptDetail>` / `<ExperimentComparison>` 给 children 就换排列):否决。一个组件不要有「给了子节点走一套、不给走另一套」的两份语义；覆盖方式统一为「不用它，直接写那棵树」，两篇文档各自给出等价全文。

## 判据(留给后续加组件用)

成为结构子节点的三条:同型条目的列表 / 只作用于某个子部分的局部配置 / 条目自己还要分组。都不命中就是 props。**不为只有一种合法值的绑定摆节点**——这条挡住了给 `StabilityMatrix` 加 `<Rows>`、给 `DeltaTable` 加行维度节点。

相关:[[report-page-level-color-assignment]](同批定的跨组件色分配)、[[chart-subcomponent-syntax-decisions]](图表子组件语法的上一轮收敛)、[[group-matrix-dedicated-component-ruling]]。
</content>
