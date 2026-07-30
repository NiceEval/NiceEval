# Experiment table

`ExperimentTable` 显示当前 Sample 的实验详情：

```tsx
<ExperimentTable />
```

它从显式 `input` 或当前 `ctx.scope` 读取 Sample，调用 `toExperimentRows()`，
再交给官方层级 `Table`：

```text
Experiment
└── Eval
    └── Attempt
```

Experiment 行显示 agent、model、耗时、主读数、tokens、成本与判定构成。
路径段组行按同一批读数聚合它下面的题；Eval 行显示该题的聚合结果。

Attempt 行只有 locator，判定长在 locator 上：前面一个判定符，整个 locator 取判定的语义色。

| 判定 | 判定符 | 色 |
|---|---|---|
| passed | `✓` | positive（绿） |
| failed | `✗` | negative（红） |
| errored | `!` | warning（黄） |

判定符与色同场，所以单色打印和色觉障碍下这一列照样读得出。
失败摘要不进这个表——点开 Attempt 详情看断言、对话与文件改动。
在 `view` 宿主中点击 Attempt 使用报告显式声明的 Attempt page 打开详情 modal；
没有声明时由 view 使用官方 `AttemptDetails` 补位。
`show` 按层级缩进输出同一批行。

`searchable` 默认为 `true`。`sort`、`locale` 与 `className` 透传给官方 `Table`。
