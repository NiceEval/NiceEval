# Experiment table

`ExperimentTable` 显示当前 Sample 的实验详情：

```tsx
<ExperimentTable />
```

它从显式 `input` 或当前 `ctx.scope` 读取唯一一份 Sample，调用 `toExperimentRows()`，再交给官方层级 `Table`：

```text
Experiment
└── Eval
    └── Attempt
```

报告组件不调用 Sample 转换，也不读取 Run 的运行期计划。
判定计票、通过率、得分、耗时、tokens 与成本全部只消费 `sample.attempts`。

## 当前结果只有一种

实际执行、携带合入与从可比旧 Run 补入的 Attempt 都是 current 结果，使用同一行形状并正常计票。
`AttemptHandle.carried` 只在 Attempt 详情中解释来源，不产生表格筛选、降饱和样式或额外覆盖分类。

不同 `configHash` 的历史结果不进入表格读数。
它只帮助 Sample 把缺口原因判断为 `previous-result`，并提供可下钻的旧 locator；旧 verdict 不作为当前表格的参考值显示。

## 身份格与行数

Experiment 身份格只显示 experiment id，例如 `compare/codex`。
Eval 与 Attempt 不因只有一次 Attempt 合并：Eval 行表达题级折叠，Attempt 行保留 locator、判定、耗时、成本与下钻入口。

Attempt 行身份格只有 locator，判定长在 locator 上：前面一个判定符，整个 locator 取判定语义色。

| 判定 | 判定符 | 色 |
|---|---|---|
| passed | `✓` | positive |
| failed | `✗` | negative |
| errored | `!` | warning |

模型与 Agent 只有 Experiment 口径；主读数只在 Experiment 与路径段组显示。
耗时、成本与 Tokens 在 Experiment、路径段组、Eval、Attempt 四层各显示自己的口径：

- Experiment：先对每个 Eval 的 Attempts 取平均，再对所有 Eval 取宏平均。
- 路径段组：只在该组覆盖的 Eval 上取同样的宏平均。
- Eval：该题所有 Attempts 的平均。
- Attempt：该次 Attempt 的精确值；单样本也沿用同一列，因此列名统一为“平均耗时”“平均 Tokens”“平均成本”。

Tokens 表示完整模型流量，计算为 `inputTokens + cacheReadTokens + cacheCreationTokens + outputTokens`。
两个缓存桶未提供时按零处理；`inputTokens` 或 `outputTokens` 未提供时，该 Attempt 的 Tokens 为缺数据。
它是用于横向比较的平均量，不是范围总量；需要总用量与缓存明细时使用 `niceeval show ... --usage`。

`searchable` 默认为 `true`。
`sort`、`locale` 与 `className` 透传给官方 `Table`。

## 缺口原因与动作

缺口 Eval 保留一条占位行，不进入任何聚合读数。
占位行读取 `SampleCoverage.missing`：

- `never-run` 显示“尚未运行”，动作是运行对应 Eval。
- `previous-result` 显示“当前配置下没有结果”，并提供最近旧 locator；动作是重新运行，或由用户显式执行 `niceeval accept @<locator>`。

旧 locator 只是审计与授权入口。
Reports 不预判 `accept` 一定成功，也不把旧 verdict、时距或样式混入当前结果。

## 报告没有口径开关

Experiment 表格不提供改变 Sample 贡献集合、覆盖分母或导出值的控件。
排序、搜索和视觉折叠可以改变行的摆放或可见性，但不能改变任何统计。

show、view 或站点需要不同范围时，由宿主重新打开 Record、创建 Sample 并重新渲染整份报告。
