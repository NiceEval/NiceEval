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

Experiment 身份格只显示 experiment id，例如 `compare/codex`。Eval 数、Attempt 数和覆盖构成不占首列：它们不改变读者在此表中比较模型、Agent、通过率、耗时与成本的判断，窄屏下反而挤掉实验名。路径段组行仍写 `downshift (6 evals)`，因为该数字说明这条组行包含的实体范围。

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

## 数字只算当前结果集

表里的每个数字都只消费 `sample.attempts`：判定计票、通过率、耗时、tokens、成本与主读数都在这一批 attempt 上算。
过期结论是记录里存在、但 configHash 与当前基准不可比的历史判定，它永远不进任何分母，也不进任何计数。
它只以参考身份出现在[占位行](#覆盖缺口的两档占位行)上，让读者知道那道题在可比范围之外还有过什么结论。

[历史执行](../../../sample/library.md#时效新执行与历史执行)与此相反：携带与跨 Run 拼入都受 configHash 前提保护，是当前结果集的正当组成，照常进计数。
两者因此不共用一种呈现——历史执行长在自己的 attempt 行上，过期结论只挂在占位行上。

## 覆盖构成

Experiment 副行把这个实验的已知题按当前结论的出身分成四段，四段互斥且合计等于 `coverage.knownEvalIds` 的题数：

| 段 | 这道题的状态 |
|---|---|
| 新执行 | 至少有一条 attempt 属于该实验最新 Run 的新执行 |
| 历史执行 | 有 attempt，但全部是携带或跨 Run 拼入的历史执行 |
| 过期结论 | 当前口径下没有 attempt，`sample.historyAttempts` 里有与当前基准不可比的判定 |
| 未跑到 | 当前口径下没有 attempt，历史里也没有 |

前两段是表里有数据的题，后两段各对应一档占位行。
副行因此一句交代分母怎么构成的：`6/8 个 Eval · 6 次 attempt · 5 新执行 · 1 历史执行 · 1 过期结论 · 1 未跑到 · 2026-07-12T10:08:29.361Z`（整行见[默认报告](../../show/default-report.md)）。

覆盖构成交给一个中立的[构成格](../primitives/table.md#构成格)：它只收一串 `{ label, count }`，段名由这次投影按 locale 给出。
格自己不知道段的业务含义，因此换一套分段不改渲染面。
计数为零的段不出现，与判定计票同一条规则。

web 面把各段画成一条分段条，hover 一段给出它的计数与解释；text 面退化成与判定计票同构的计数串。
两面读同一份 `segments`，段序即声明序。

## 时效不写字

历史执行与过期结论的行上不出现「历史」「过期」这类词标。
三条通道各承担一部分说明，缺一条时其余的照常成立：

- **样式**：格渲染器按格上的时效字段给出降饱和的语义 class，与判定格给 `niceeval-verdict-*` 走同一条路径。
  `Table` 只把格交给渲染器，行层不出现时效分支。
- **数据**：相对时距紧贴 locator（`@1pcdj0az 2d`），它是格里的一个值，不是加在旁边的记号。
  读法由 [`formatTimeDistance()`](../../library/presentation.md#公开函数总表) 单点给出，两面同源。
- **交互**：web 面 hover locator 出 tooltip，把这条结论的出身、时距与它进不进计数说完；点 locator 打开 Attempt 详情。
  tooltip 文案走 locale key，与读数格的覆盖 title 同一条机制。

text 面没有 hover，只剩样式与数据两条，而且它连颜色也没有，所以时距在 text 面是唯一的时效信号。
tooltip 因此只做展开：它解释已经显示出来的那个时距，不承载「不 hover 就丢失」的事实。

## 覆盖缺口的两档占位行

覆盖缺口是一条 Eval 占位行，照常显示，但不进任何列的聚合读数。
占位行的结果格是 [`missing` 格](../../library/presentation.md#缺数据不适用与占位)，按记录里有没有可参考的结论分两档：

- **未跑到**：格只带 `code` 与补跑命令，显示「当前配置下无结果」和可直接复制的那条命令。
- **过期结论**：同一个格再带 `reference`，显示那次判定的判定符、locator 与相对时距，整段降饱和；补跑命令仍在同一格。

两档说的是同一个事实——这道题在当前配置下没有结果——所以 `code` 相同，`missing` 格的原因文案也是同一句。
差别只在记录里有没有可参考的结论，也就是这道题落在覆盖构成的哪一段；带 `reference` 时用参考替代那句原因，避免同一句话在一格里说两遍。

参考取 `sample.historyAttempts` 里该题最近一条与当前基准 configHash 不可比的判定。
它不在表里解释自己为什么不可比：指纹与配置的逐项差异归 [`niceeval exp --dry`](../../../experiments/cache.md)，能不能把它接受成可携带结果归 [`accept`](../../../experiments/cache.md)。
表只提供一个下钻入口——点 locator 打开那次 Attempt 详情，读者在那里判断这个结论还值不值得参考。

`sample.fresh` 为 `true` 时占位行不带参考。
读者已经声明只看新执行，占位行就保持纯占位，不再把被自己排除掉的东西请回来。

## 只看新执行

web 面在表头给一个「只看新执行」开关。
打开时由 `ExperimentTable` 重新投影：只保留新执行的 attempt，只剩历史执行的题按覆盖事实降成占位行，换好的行集再交给 `Table`。
口径与 [`--fresh`](../../show.md#选择结果范围) 一致，text 面的等价入口就是那个 CLI 选项。

`Table` 不知道这个开关存在。
它每次只拿到一份已经算好的行集，本体里没有任何时效分支——语义住在投影层，原语只负责把行画出来。

Sample 里既没有历史执行也没有过期结论时不画这个开关：一个永远不改变行集的控件只会让人怀疑自己看漏了什么。
开关属于增强层，初始 HTML 是关闭态的完整表，无 JavaScript 时照常完整可读。
