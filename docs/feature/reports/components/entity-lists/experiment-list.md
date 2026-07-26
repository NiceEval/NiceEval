# `ExperimentList`

每项显示 experiment 身份、agent / model、flags、判定构成、官方指标和其中的 eval。组件不推断分组；默认 [`ExperimentComparison`](../summaries/experiment-comparison.md) 把当前 Sample 的全部 items 交给它。数据形状见[实体列表](README.md#数据形状)。

一行只有一套 `agent / model / flags`，这不是显示上的取舍而是输入约束：宿主注入的 [`latestKnown()` Sample 保证每个 experiment 只由可比性配置一致的 Run 拼成](../../../sample/library.md#两个选择器)；作者自选 `Run[]` 时若同一 experiment 混入不一致的可比性配置，`experimentListData` 按完整用户反馈失败并指引——看跨配置演化用 `run` 维度或[数值轴折线](../charts/line-chart.md)，不把两套配置拼成一行冒充单一配置。

web 面是固定列的 experiment 比较表，而不是无表头的松散卡片列表。主表一行一个 experiment，列顺序固定为：

| 列 | 内容 |
|---|---|
| Experiment | experiment id 在当前列表里的最短唯一后缀（见下）；副行以“`8 evals` / `8 个 Eval`”显示 eval 数——存在覆盖缺口时写成 `6/8 evals`（分母是已知并集），attempt 数多于 eval 数时再显示 attempt 数，最后跟最后运行时间；`historicalAttempts > 0` 时追加时效标注 `↩ n/m attempts`（见[时效标注](README.md#时效标注)）；不把 Eval 翻成“题”。完整 id 仍用于排序键、过滤和折叠展开 |
| Model | model；缺失时显示明确空值 |
| Agent | agent |
| Avg. time | 官方 `durationMs` 聚合值；中文列名为“平均耗时” |
| 主读数 | 按列表内题型构成选择（[主读数映射](../../library/metrics.md#题型构成与主读数)）：全通过制为“Pass rate / 通过率”列（官方 `endToEndPassRate`）；全计分制为“Total score / 总分”列（官方 `totalScore`）；两型并存时两列都出、不适用格显示 `—`，不摆空列。默认按主读数列从高到低排序；两型并存时两种读数不能互相排名，默认改按 experiment id 字典序，两个主读数列仍各自可点击排序 |
| Tokens | 官方 `tokens` 聚合值 |
| Cost | 实验总成本：官方 `costUSD` 逐 attempt 求和（每题均值口径归图表与表格，见[默认报告](../../show/default-report.md)）；实测成本优先、估算兜底，列头不断言口径 |
| Results | passed / failed / errored / skipped 的 eval 级判定构成，各项以中点分隔，不渲染成类似按钮的胶囊 |

表头支持点击排序；标签和排序箭头作为一个不换行的单元对齐，当前排序方向始终可见，其余列的排序提示只在 hover / focus 时显示。宽度不足时整表横向滚动，不把标签与箭头拆成两行。`filter` 为 web 面增加过滤输入框，可按 experiment、agent、model、flag 或 eval 文本收窄行。排序和过滤只改变浏览状态，不改变数据、指标口径或 text 面输出。每个 experiment 行使用原生 `<details>` 展开，展开区显示 flags 和 Eval 列表。Eval 父行只显示折叠判定、Attempt 数以及这个 Eval 的平均耗时 / 平均成本，计分制实验的 Eval 父行与 Attempt 子行还各自显示挣分；每个 Attempt 子行再显示该轮判定、locator、耗时 / 成本与 [Scoring 定义的主失败断言摘要](../../../scoring/library/display.md#主失败断言怎样选)，可继续下钻到 Attempt 详情。父行不复述某一轮的失败原因：单轮时会与唯一子行重复，多轮时挑任一轮又会冒充 Eval 级事实。通过制 passed attempt 的 Result 是 `—`，不罗列通过的 assertions；计分制 passed attempt 有丢分得分点时 Result 显示首条丢分摘要（[丢分摘要规则](../../../scoring/library/display.md#主失败断言怎样选)），挣满才显示 `—`。

覆盖缺口呈现为**占位行**：`missingEvalIds` 里的每道题在展开区渲染一条 Eval 父行，状态列为 `—`，结果列为「当前配置下无结果」加可复制的补跑命令（`niceeval exp <experimentId>`），无 attempt 子行；text 面同构。占位行不参与任何指标——通过率、耗时、成本的分母仍是有 attempt 的题，缺口不冒充失败；它的职责是把分母缺口摆进读者正在看的表里，而不是藏进页面级脚注。

行标签是 experiment id 在当前列表里的最短唯一后缀：末段（最后一个 `/` 之后的部分）在这批 id 里唯一就只显示末段；多个 id 末段撞名时，撞名的那几个各自向前多取一段，重复直到互相区分为止（与[散点点标签](../charts/README.md#两面投影)同一算法，两处共用同一份实现）。这是纯展示层的收窄——排序键、过滤匹配和折叠展开都用完整 id。组件不提供覆盖这份自动结果的开关：算法本身已经保证「唯一时最短、撞名时刚好够用的长度」，报告作者不需要手动指定要去掉的路径前缀。

Agent 键的颜色来自[页级色分配](../README.md#系列色分配单位是页)，键是完整 agent 值而不是缩短后的显示名——同一页里图例、散点与这张表的同一个 agent 因此恒同色。

text 面先输出与 web 同列口径的 experiment 比较表（列集合随主读数规则，与 web 面一致），再按 experiment 输出 Eval / Attempt 明细表。Eval 是父行，不是 Attempt 行上的重复字段；Attempt 用 `├─` / `└─` 子行显示一对多关系。明细列固定为状态、Eval / Attempt、结果、耗时、成本（计分制 Sample 在结果列前插入挣分列）；窄终端复用标准 text table renderer 折行或从右侧隐藏低优先级列，并明确报告隐藏列数：

```text
Experiment      Model          Agent   Avg. time   Pass rate   Tokens   Cost    Results
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

计分制 Sample 的同一张表把主列换成总分，Eval / Attempt 明细行各自附挣分；Result 列遵守同一套摘要规则——中止的 attempt 显示中止前置的摘要，passed 但有丢分的显示首条丢分得分点摘要：

```text
Experiment    Model     Agent    Avg. time   Total score   Tokens   Cost    Results
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
// 全量列表：spec 形态一行
<ExperimentList filter />
```

```tsx
// 过滤后的列表：组合组件里手工取数，用普通 JavaScript 收窄
export const ProdExperiments = defineComponent(async (_props: {}, ctx) => {
  const items = await experimentListData(ctx.sample);
  return <ExperimentList data={items.filter((x) => x.experimentId.startsWith("prod/"))} filter />;
});
```

## 相关阅读

- [实体列表](README.md) —— 数据形状与时效标注。
- [`EvalList`](eval-list.md) / [`AttemptList`](attempt-list.md) / [`FailureList`](failure-list.md) —— 其它实体列表。
