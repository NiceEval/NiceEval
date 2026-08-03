# Experiment table

`ExperimentTable` 显示当前 Sample 的实验详情：

```tsx
<ExperimentTable />
```

它从显式 `input` 或当前 `ctx.scope` 读取 Sample，调用 `toExperimentRows()`，再交给官方层级 `Table`：

```text
Experiment
└── Eval
    └── Attempt
```

层级里没有特殊行：每一行都用同一份列集填格，值全部由这次投影算好， `Table` 只按列集取格并逐层展开，不感知 experiment、题与 attempt 的语义。
判定构成列因此每层都有值，形态只有计票与单判定两种：

- Experiment 行与路径段组行显示其下题目的判定计票（`16 通过 · 10 失败 · 2 错误`），每个计数取自己的判定语义色；组行的其余读数按同一批读数聚合它下面的题。
- Eval 行显示该题 attempts 的判定计票（`1 通过 · 1 失败`）。
  题目级结论按 attempt 折叠：任一 attempt passed 即通过，重试先挂后过的题照样算通过（text 面的同一语义见[默认报告的重试例](../../show/default-report.md)）。
- Attempt 行显示该次判定词，判定符与语义色同下表。

## 身份格与行数

Experiment 身份格只显示 experiment id，例如 `compare/codex`。Eval 数、Attempt 数和来源快照不占首列：它们不改变读者在此表中比较模型、Agent、通过率、耗时与成本的判断，窄屏下反而挤掉实验名。路径段组行仍写 `downshift (6 evals)`，因为该数字说明这条组行包含的实体范围。

因此一个路径段只占一条组行，组名和题数不可拆成 `downshift` 与下一行 `6 evals`。首格因可用宽度折行时，那仍是同一个格与同一实体行；折行、缩进和行高由 `Table` 的通用排版处理。

Eval 与 Attempt 不因只有一次 attempt 合并。Eval 行说明题目级折叠结论，Attempt 行保留可下钻的 locator、该次结论、耗时、成本与失败摘要；把两者揉成一行会抹掉重试、携带与题目级通过语义。覆盖缺口仍是一条 Eval 占位行，没有 Attempt 子行。

Experiment 行另有 agent、model、耗时、主读数、tokens 与成本。
模型、agent、主读数与 tokens 只有实验口径，Eval 与 Attempt 行显示 `—`；耗时与成本列每层显示自己口径的值：题目行是该题聚合，attempt 行是该次实测。

Attempt 行的身份格只有 locator，判定长在 locator 上：前面一个判定符，整个 locator 取判定的语义色。

| 判定 | 判定符 | 色 |
|---|---|---|
| passed | `✓` | positive（绿） |
| failed | `✗` | negative（红） |
| errored | `!` | warning（黄） |

判定符与色同场，所以单色打印和色觉障碍下这一列照样读得出。
失败摘要不进这个表——点开 Attempt 详情看断言、对话与文件改动。
在 `view` 宿主中点击 Attempt 使用报告显式声明的 Attempt page 打开详情 modal；没有声明时由 view 使用官方 `AttemptDetails` 补位。
 `show` 把同一批行画成[数据格框](../../library/layout.md#数据格框table-与-grid)，层级靠首列缩进与 `└─` 表达。

`searchable` 默认为 `true`。
`sort`、`locale` 与 `className` 透传给官方 `Table`。
