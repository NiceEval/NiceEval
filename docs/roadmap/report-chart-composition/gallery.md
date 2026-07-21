# 真实图表对照——四张报告图的结构与写法

[Library 逐组件说明](library.md)按组件给出图表族契约;这篇反向检验:拿四张真实世界的 eval 报告图(模型排行、多题集面板、成本构成、成本-质量前沿),逐张拆出**结构要素**、给出契约下的写法;图中存在但 niceeval 设计上不支持的功能逐条写明理由,汇总见文末[对照结论](#对照结论)。对照只看结构——柱怎么排、哪里有误差线、什么和什么画在同一张画布;配色、字体、圆角这类样式不在对照范围,结构等价之后样式由主题层收敛。写法沿用[指标组件](../../feature/reports/library/metric-views.md)的示例指标(`endToEndPassRate`、`costUSD` 等)。

## 图 1——单指标排行条形与置信区间

![按单一指标排行的横向条形图:一行一个模型,条上叠置信区间须线,行尾显示数值](assets/pass-at-1-ranked-bars.png)

**结构要素:** 一个维度(模型)按单一指标降序排行,每个维度值一根横向条;条上叠置信区间须线;行尾数值标签;行首维度值标签。

**写法**——`MetricBars` 排行形态 + `ErrorBar`(契约见 [Library · MetricBars](library.md#metricbars)、[Library · ErrorBar](library.md#errorbar)):

```tsx
<MetricBars rows="agent" cell={endToEndPassRate} sort={endToEndPassRate}>
  <ErrorBar />
</MetricBars>
```

排序由 `sort` 承担,方向由指标的 `better` 决定;置信区间从聚合值自带的 attempt 样本证据计算,作者不自备误差值;条尾数值是排行形态的默认呈现,不需要声明。

## 图 2——多题集小面板

![八个题集各一块条形小面板,同一组模型横跨全部面板,其中一个模型全程强调](assets/per-eval-bar-panels.jpg)

**结构要素:** 同一组维度值(模型)在多个题集上各成一块小面板;面板内条形 + 顶部数值;某一个维度值(自家模型)在所有面板中统一强调;全部面板共享一份图例。

**写法**——`Grid` + JSX 遍历,每面板一个排行形态 `MetricBars`(`evals` 前缀过滤);`by` 兜底展开 + `value` 强调,按 [Library · ChartSeries](library.md#chartseries) 的合并规则生效:

```tsx
<Grid columns={4}>
  {["terminal-bench/", "swe-verified/", "swe-pro/", "swe-multilingual/"].map((prefix) => (
    <MetricBars key={prefix} evals={prefix} rows="agent" cell={examScore}>
      <ChartSeries by="agent" />
      <ChartSeries value="ornith-9b" emphasis />
    </MetricBars>
  ))}
</Grid>
```

**设计上不支持的两处:**

- **facet 容器**(一次声明、按题集展开成面板):报告是 TSX,这就是一次普通的数组 map,框架再包一层只是复述语言已有的能力。
- **跨面板集中共享图例**:每块面板自带图例;「同一 series 跨面板同色」由配色稳定散列契约(同键跨图同色)承担,一致性不依赖共享图例。

## 图 3——成本构成堆叠条形

![每个模型组合一根柱,柱内按 Planner/Worker 成本构成堆叠,柱顶显示总成本](assets/stacked-cost-bars.webp)

**结构要素:** 每个配置(模型组合)一根柱;柱内按成本构成堆叠,两段各是一个指标;柱顶显示堆叠总值;图例标构成;图底脚注说明口径。

**写法**——每段一个自带 `metric` 的 `ChartSeries`,`stack` 同值成堆;柱顶总值标签是堆叠呈现的默认组成部分(契约见 [Library · MetricComposed](library.md#metriccomposed)):

```tsx
// plannerCostUSD / workerCostUSD 是作者自定义的成本构成指标
<MetricComposed x="experiment">
  <ChartSeries as="bar" metric={plannerCostUSD} stack="cost" />
  <ChartSeries as="bar" metric={workerCostUSD} stack="cost" />
</MetricComposed>
```

图题与脚注不进图表契约,属排版层:`Col` 里加文本节点。

## 图 4——成本-质量前沿散点

![各模型的成本-质量前沿:series 内沿成本轴连线,成本轴反向(便宜在右),单点与多点 series 混排](assets/cost-quality-frontier.png)

**结构要素:** 点=一次运行配置,series=模型;series 内沿成本轴连成前沿曲线;成本轴 `better: "lower"` 反向渲染(便宜在右,「越靠右上越好」);多点 series 与单点 series 混在同图。

**写法**——现状 `MetricScatter` 契约全覆盖,一行:

```tsx
<MetricScatter points="experiment" series="agent" connect x={costUSD} y={endToEndPassRate} />
```

`connect` 连线、轴反向(图里 $20 → $0 正是成本轴反向)、单点 series(无箭头无摘要)、点级直接标签都是现状契约。**设计上不支持**:series 名标注在线端以替代图例——图例契约两面同源、顺序确定,点级直接标签已承担就近识别,理由见 [Library · MetricScatter](library.md#metricscatter不子组件化)。

## 对照结论

- 四张图的全部结构形态都落在图表族契约内:图 1 = 排行形态 + `ErrorBar`,图 2 = `Grid` 遍历 + `by`/`value` 合并,图 3 = `MetricComposed` + `stack`,图 4 = 现状 `MetricScatter`。结构最复杂的一张恰好是现状契约覆盖最好的——佐证「概念数量固定的组件不子组件化」的判定。
- 设计上不支持的功能与理由:**facet 容器**(JSX map 已覆盖)、**跨面板集中共享图例**(稳定散列同色承担一致性)、**线端 series 标注**(与图例、点级标签重复)。
- 样式(配色、字体、圆角、渐变)不在对照范围,由主题层收敛。

## 相关阅读

- [README](README.md) —— 问题、recharts 模型与设计定案。
- [Library 逐组件说明](library.md) —— 本页写法引用的逐组件契约。
- [Architecture](architecture.md) —— 结构描述子节点与容器解释机制。
- [指标组件](../../feature/reports/library/metric-views.md) —— 现状组件的完整 props 契约。
