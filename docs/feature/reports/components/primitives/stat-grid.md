# `Grid` 与 `Stat`

`Grid` 接有序 `items`，`Stat` 接一个 MetricValue 或显式 external 标量：

```tsx
<Grid
  items={[
    <Stat label="Pass rate" value={summary.passRate} />,
    <Stat label="Cost" value={summary.costUSD} />,
  ]}
/>
```

MetricValue 的 unit、format、samples、total 与 refs 保持完整，renderer 按 locale 格式化。
缺数据显示明确占位，不转成零。

Grid 根据格数与自身可用宽度换列，不读取视口宽度。
text 面按终端显示列选择一行或多行；web 面使用容器查询。

两面的每格都是一个格子：web 面是 grid 单元，text 面是
[数据格框](../../library/layout.md#数据格框table-与-grid)——外框、列边界，
行与行之间一条 `┼` 接头的横线；末行不足一整行时最后一格吃掉剩余宽度，横线上那几个边界跟着收成 `┴`：

```text
╭──────────────┬─────────────┬───────╮
│ Pass rate    │ Experiments │ Evals │
│ 80%          │ 3           │ 5     │
├──────────────┼─────────────┴───────┤
│ Attempts     │ Eval results        │
│ 5            │ 4 passed · 1 failed │
╰──────────────┴─────────────────────╯
```

格宽贴合内容：`80%`、`$0.92` 这种短读数不为占满终端而撑开。

`Grid` 放进 `Section` 时不画自己的外框，只保留列边界与行间横线。
非 TTY 或窄于 60 列时格线消失，降为按列对齐的纯文本。

## 相关阅读

- [排版原语](../../library/layout.md#grid-与-stat)
