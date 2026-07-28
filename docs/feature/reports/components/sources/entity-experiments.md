# `sources.entity.experiments`

`sources.entity.experiments` 是 [`Table`](../primitives/table.md) 的数据源。每个顶层 Row 对应一个 Experiment,
并经 [Eval 组](#eval-分组层)下钻到 Eval 与 Attempt;固定列包含身份、agent、model、flags、判定构成、官方读数与覆盖缺口。
默认 [`SampleOverview`](../summaries/sample-overview.md) 使用它呈现当前 Sample。

一行只有一套 `agent / model / flags`。这不是显示取舍，而是输入约束：
[`currentSample()`](../../../sample/library.md#两个选择器) 保证每个 experiment 只组合可比配置一致的 Run。

Sample 选择器保证同一 experiment 的当前口径只对应一套可比配置；组件不接受裸 `Run[]`。
跨配置演化应使用 `run` 维度或[折线 mark](../charts/line-chart.md)，不能把两套配置冒充成一行。

web 面是固定列的 experiment 比较表，而不是无表头的松散卡片列表。主表一行一个 experiment，列顺序固定为：

| 列 | 内容 |
|---|---|
| Experiment | experiment id 在当前列表里的最短唯一后缀（见下）；副行以“`8 evals` / `8 个 Eval`”显示 eval 数——存在覆盖缺口时写成 `6/8 evals`（分母是已知并集），attempt 数多于 eval 数时再显示 attempt 数，最后跟最后运行时间；`historicalAttempts > 0` 时追加时效标注 `↩ n/m attempts`（见[时效标注](entity.md#时效标注)）；不把 Eval 翻成“题”。完整 id 仍用于排序键、过滤和折叠展开 |
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

每个 experiment 行使用原生 `<details>` 展开，展示 flags 和 Eval 列表。展开层级是
Experiment → [Eval 组](#eval-分组层) → Eval → Attempt；分组层无信息时整层收起，
读者看到的就是 Experiment → Eval → Attempt。Eval 父行只显示：

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

## Eval 分组层

题一多，experiment 行展开后就是一张平铺长列表：读者能看到每道题的结果，却看不出「哪一类题
拖了后腿」。分组层把这个判断提前到收起状态——一个组一行，带该组的聚合读数，展开才进单题。

**分组键是 eval id 的目录前缀**，即第一个 `/` 之前的段。这不是从 id 字符串猜分类：eval id
[从文件路径推导](../../../eval/README.md#defineeval-的形状)（`evals/downshift/pr-1484.eval.ts`
→ `downshift/pr-1484`），目录结构是作者已经声明过的组织方式，读回来是还原声明。

不用 [`tags`](../../../eval/library.md#tags-与-environment让-experiment-选择) 分组。一个 eval 可以带多个
tag，同一道题会同时落进多个组，组行的分母互相重叠，算出来的比值只是重复计数。层级要求分区，
tags 是标注，两者不能互换。要按 tags 横切，用 [`sources.measure.rows`](measure-rows.md) 配自定义
维度——那是读数表，不是下钻树。

### 无信息时整层收起

任一条成立就不插入分组层，展开直接是 Experiment → Eval：

- **只有一个组**：套一层壳，不增加任何区分；
- **每个组都只有一道题**：多一次点击，没有聚合。

eval id 不含 `/` 的题与组行同级挂在 experiment 下。不造「未分组」「其它」这类组名——
那是把「没有声明」渲染成一个声明。

### 组行显示什么

遵守[父行不复述子行](../primitives/table.md#下钻子行)：

| 列 | 组行内容 |
|---|---|
| Experiment | 组前缀；副行显示组内 eval 数，存在覆盖缺口时写成 `2/3 evals`（分母是该组的已知并集），attempt 数多于 eval 数时再显示 attempt 数 |
| Model / Agent | `—`（`notApplicable`）：分组不改变配置，复述 experiment 行的值只是噪音 |
| Avg. time / Tokens / Cost | 组内聚合，与 experiment 行同口径 |
| 主读数 | 组内通过率或总分，按同一[主读数映射](../../library/measures.md#题型构成与主读数)选列 |
| Record | 组内 eval 级判定构成 |

组行**有**主读数而 Eval 行**没有**，这不是不一致：单题的通过率只会是 0% 或 100%，
是它折叠判定的重复表达；组内有多道题，通过率才重新成为读数。

**子行不复述父行的前缀。** 组行是 `downshift` 时，组内 Eval 行标签是 `pr-1484` 而不是
`downshift/pr-1484`——前缀已由父行表达过一次，这是「父行不复述子行」的对偶。完整 evalId 仍是
排序键、过滤匹配文本与展开身份。整层收起时 Eval 行标签照旧是完整 evalId，没有父行替它表达前缀。

**占位行按同一前缀落进对应组**，组行副行的 `2/3 evals` 分母因此含缺口。占位行仍不参与任何
读数：组行的通过率、耗时与成本的分母只数有 attempt 的题。一个组的题全部缺失时，组行照常出现，
读数格为 `missing` 而不是 `—`——那是「本该有却没跑到」，不是「对这一行没有意义」。

### 排序与过滤在分组下的行为

**排序在兄弟之间进行。** 组行按主读数从高到低预排，与 experiment 行同规则；组内 Eval 保持既有
顺序。点击表头重排的是每一层的兄弟行，不把 Eval 提到组外跨组重排——跨组重排会让层级失去意义。

**过滤保留结构，不改口径。** `filter` 命中 Eval 文本时保留其组行并展开到命中行；命中组前缀时
整组保留。组行显示的始终是全组读数，不是命中子集的读数：过滤是浏览状态，改了口径就成了另一份
数据。这与 `Table` 的[排序与过滤](../primitives/table.md#排序与过滤)纪律是同一条。

text 面先输出与 web 同列口径的 experiment 表，再按 experiment 输出 Eval / Attempt 明细。
Eval 是父行，Attempt 用 `├─` / `└─` 子行表达一对多关系；有分组层时组行是 Eval 的父行，
`├─` / `└─` 逐层缩进。

明细列是状态、Eval / Attempt、结果、耗时与成本；计分制在结果前增加挣分列。
窄终端使用标准 text table renderer 折行，或从右侧隐藏低优先级列，并报告隐藏列数：

```text
Experiment      Model          Agent   Avg. time   Pass rate   Tokens   Cost    Record
compare/codex   gpt-5.4-mini   codex   1m 12s      50%         42k      $0.08   1 passed · 1 failed
2/3 evals · 3 attempts · ↩ 1/3 attempts · 2026-07-12 18:08

compare/codex
Status       Eval / Attempt              Result                     Duration    Cost
1 passed     algebra · 1 eval · 100%                                17.1s avg   $0.02 avg
✓ passed     ├─ retry                                               17.1s avg   $0.02 avg
  ✗          │  ├─ @1first01             equals(42) · received 41   16.0s       $0.02
  ✓          │  └─ @1second2             —                          18.2s       $0.02
1 failed     weather · 1/2 evals · 0%                               42.1s avg   $0.04 avg
✗ failed     ├─ tool   ↩ 3d                                         42.1s avg   $0.04 avg
  ✗          │  └─ @1third03   ↩ 3d      calledTool("get_weather") · received 2 tool calls: get_time({}) …   42.1s   $0.04
—            └─ rerank                   当前配置下无结果 · niceeval exp compare/codex
```

text 面的明细树没有主读数列，组行的主读数跟在标签后（`weather · 1/2 evals · 0%`），
Status 列放该组的 eval 判定构成——与 web 的 Record 列同一份事实。不为组行单开一列让
Eval / Attempt 行整列显示 `—`。

分组层收起时（只有一个组，或每组只有一道题）没有组行，Eval 是 experiment 的直接子行，
标签是完整 evalId：

```text
compare/codex
Status      Eval / Attempt       Result                       Duration    Cost
✓ passed    algebra/retry                                     17.1s avg   $0.02 avg
  ✗         ├─ @1first01         equals(42) · received 41     16.0s       $0.02
  ✓         └─ @1second2         —                            18.2s       $0.02
```

计分制 Sample 把主列换成总分，Eval 与 Attempt 明细行各自附挣分。
Result 遵守同一摘要规则：中止显示中止前摘要，passed 但有丢分时显示首条丢分摘要。

```text
Experiment    Model     Agent    Avg. time   Total score   Tokens   Cost    Record
exam/claude   gpt-5.6   claude   9m 20s      142           3.9M     $4.37   36 passed · 4 failed
exam/codex    gpt-5.6   codex    7m 02s      117           2.8M     $3.10   33 passed · 7 failed

exam/claude
Status              Eval / Attempt          Score   Result                                                        Duration   Cost
1 passed · 1 failed dbgpt · 2 evals · 5     5
✓ passed            ├─ health-probe         4
  ✓                 │  └─ @1hlthp01         4       commandSucceeded() · received exit 1 · +0 pts · +1 more lost point   6m 40s   $0.42
✗ failed            └─ install-start        1
  ✗                    └─ @1dbgpt001        1       calledTool("shell", { input: { command: /pip install/ } }) · received 0 tool calls   4m 12s   $0.31
```

计分制组行的 Score 是组内挣分之和，与 experiment 行的 `totalScore`
（[perEval mean、acrossEvals sum](../../library/measures.md#内置读数)）同口径。

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

- [实体数据源](entity.md) —— 数据形状、时效标注与 `sources.entity.evals` / `sources.entity.attempts`。
- [`FailureList`](../summaries/failure-list.md) —— 筛选失败 Attempt 的组合组件。
