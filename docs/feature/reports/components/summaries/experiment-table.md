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
Eval 行显示该题的聚合结果；Attempt 行保留 locator。
在 `view` 宿主中点击 Attempt 使用报告现有的 Attempt 路由打开详情 modal；
`show` 按层级缩进输出同一批行。

`searchable` 缺省为 `true`。`sort`、`locale` 与 `className` 透传给官方 `Table`。
