# `sources.entity.experiments`

`sources.entity.experiments` 是 [`Table`](../primitives/table.md) 的数据源。每个顶层 Row 对应一个 Experiment,
并下钻到 Eval 与 Attempt;固定列包含身份、agent、model、flags、判定构成、官方读数与覆盖缺口。
默认 [`SampleOverview`](../summaries/sample-overview.md) 使用它呈现当前 Sample。

一行只有一套 `agent / model / flags`。这不是显示取舍，而是输入约束：
[`currentSample()`](../../../sample/library.md#两个选择器) 保证每个 experiment 只组合可比配置一致的 Run。

Sample 选择器保证同一 experiment 的当前口径只对应一套可比配置；组件不接受裸 `Run[]`。
跨配置演化应使用 `run` 维度或[折线 mark](../charts/line-chart.md)，不能把两套配置冒充成一行。

web 面是固定列的 experiment 比较表，而不是无表头的松散卡片列表。主表一行一个 experiment，列顺序固定为：

| 列 | 内容 |
|---|---|
| Experiment | experiment id 在当前列表里的最短唯一后缀（见下）；副行以“`8 evals` / `8 个 Eval`”显示 eval 数——存在覆盖缺口时写成 `6/8 evals`（分母是已知并集），attempt 数多于 eval 数时再显示 attempt 数，最后跟最后运行时间；`historicalAttempts > 0` 时追加时效标注 `↩ n/m attempts`（见[时效标注](README.md#时效标注)）；不把 Eval 翻成“题”。完整 id 仍用于排序键、过滤和折叠展开 |
| Model | model；缺失时显示明确空值 |
| Agent | agent |
| Avg. time | 官方 `durationMs` 聚合值；中文列名为“平均耗时” |
| 主读数 | 按列表内题型构成选择（[主读数映射](../../library/measures.md#题型构成与主读数)）：全通过制为“Pass rate / 通过率”列（官方 `passRate`）；全计分制为“Total score / 总分”列（官方 `totalScore`）；两型并存时两列都出、不适用格显示 `—`，不摆空列。默认按主读数列从高到低排序；两型并存时两种读数不能互相排名，默认改按 experiment id 字典序，两个主读数列仍各自可点击排序 |
| Tokens | 官方 `tokens` 聚合值 |
| Cost | 实验总成本：官方 `costUSD` 逐 attempt 求和（每题均值口径归图表与表格，见[默认报告](../../show/default-report.md)）；实测成本优先、估算兜底，列头不断言口径 |
| Record | passed / failed / errored / skipped 的 eval 级判定构成，各项以中点分隔，不渲染成类似按钮的胶囊 |

表头支持点击排序。标签与箭头不换行；当前方向始终可见，其它提示只在 hover / focus 时出现。
宽度不足时整表横向滚动。`filter` 可按 experiment、agent、model、flag 或 eval 文本收窄行。
排序与过滤只改变浏览状态，不改变 Content、读数口径或 text 面。

每个 experiment 行使用原生 `<details>` 展开，展示 flags 和 Eval 列表。Eval 父行只显示：

- 折叠判定与 Attempt 数；
- 该 Eval 的平均耗时与平均成本；
- 计分制下该 Eval 的挣分。

Attempt 子行显示本轮判定、locator、耗时、成本与
[主失败断言摘要](../../../assertions/library/display.md#主失败断言怎样选)，并可下钻到详情。
父行不复述某一轮失败原因：单轮会重复，多轮则会把任一轮冒充成 Eval 事实。

通过制 passed attempt 的 Result 为 `—`，不罗列通过的 assertions。计分制 passed attempt
有丢分时显示首条丢分摘要；挣满才显示 `—`。

覆盖缺口呈现为**占位行**。`missingEvalIds` 中每道题都有一条 Eval 父行：状态为 `—`，
结果为“当前配置下无结果”及可复制的补跑命令，且没有 attempt 子行；text 面同构。

占位行不参与读数。通过率、耗时与成本的分母仍是有 attempt 的题，缺口不冒充失败。
它的职责是把分母缺口摆在当前表中，而不是藏进页面脚注。

行标签使用 experiment id 在当前列表里的最短唯一后缀。末段唯一时只显示末段；
撞名时逐段向前扩展，直到互相区分。它与[图表点标签](../charts/README.md#两面)共用算法。

这只是展示收窄：排序、过滤与展开仍使用完整 id。算法已经保证“唯一时最短、冲突时刚好够用”，
所以不提供手工路径前缀开关。

Agent 颜色来自[页级色分配](../README.md#维度呈现分配单位是页)，其键是完整 agent 值。
同一页的图例、图表与表格因此使用相同颜色。

text 面先输出与 web 同列口径的 experiment 表，再按 experiment 输出 Eval / Attempt 明细。
Eval 是父行，Attempt 用 `├─` / `└─` 子行表达一对多关系。

明细列是状态、Eval / Attempt、结果、耗时与成本；计分制在结果前增加挣分列。
窄终端使用标准 text table renderer 折行，或从右侧隐藏低优先级列，并报告隐藏列数：

```text
Experiment      Model          Agent   Avg. time   Pass rate   Tokens   Cost    Record
compare/codex   gpt-5.4-mini   codex   1m 12s      50%         42k      $0.08   1 passed · 1 failed
2/3 evals · 3 attempts · ↩ 1/3 attempts · 2026-07-12 18:08

compare/codex
Status      Eval / Attempt       Result                       Duration   Cost
✓ passed    algebra/retry                                      17.1s avg   $0.02 avg
  ✗         ├─ @1first01         equals(42) · received 41   16.0s   $0.02
  ✓         └─ @1second2         —                            18.2s      $0.02
✗ failed    weather/tool   ↩ 3d                               42.1s avg   $0.04 avg
  ✗         └─ @1third03   ↩ 3d   calledTool("get_weather") · received 2 tool calls: get_time({}) …   42.1s   $0.04
—           weather/rerank       当前配置下无结果 · niceeval exp compare/codex
```

计分制 Sample 把主列换成总分，Eval 与 Attempt 明细行各自附挣分。
Result 遵守同一摘要规则：中止显示中止前摘要，passed 但有丢分时显示首条丢分摘要。

```text
Experiment    Model     Agent    Avg. time   Total score   Tokens   Cost    Record
exam/claude   gpt-5.6   claude   9m 20s      142           3.9M     $4.37   36 passed · 4 failed
exam/codex    gpt-5.6   codex    7m 02s      117           2.8M     $3.10   33 passed · 7 failed

exam/claude
Status      Eval / Attempt              Score   Result                                                        Duration   Cost
✓ passed    dbgpt/health-probe          4
  ✓         └─ @1hlthp01                4       commandSucceeded() · received exit 1 · +0 pts · +1 more lost point   6m 40s   $0.42
✗ failed    dbgpt/install-start         1
  ✗         └─ @1dbgpt001               1       calledTool("shell", { input: { command: /pip install/ } }) · received 0 tool calls   4m 12s   $0.31
```

窄屏允许表格横向滚动，不能为了适应宽度删除列、把多个无标签数值挤成一串，或退化成无法判断各数字含义的无表头布局。

```tsx
<Table source={sources.entity.experiments} filter />
```

```tsx
// 过滤后的层级行：组合组件里手工计算，再用普通 JavaScript 收窄
export const ProdExperiments = defineComposition(async (_props: {}, ctx) => {
  const content = await ctx.resolve(sources.entity.experiments);
  return <Table data={{
    ...content,
    rows: content.rows.filter((row) => row.key.startsWith("prod/")),
  }} filter />;
});
```

## 相关阅读

- [实体列表](README.md) —— 数据形状与时效标注。
- [`sources.entity.evals`](eval-rows.md) / [`sources.entity.attempts`](attempt-rows.md) /
  [`FailureList`](failure-list.md) ——
  其它实体数据源与失败组合组件。
