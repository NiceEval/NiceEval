# `Table`

`Table<Row>` 接普通只读 `rows`：

```tsx
<Table rows={performance} />
```

省略 columns 时按第一行的稳定字段顺序推导。
自定义列时传字段名或列定义：

```tsx
<Table
  rows={performance}
  columns={[
    "agent",
    { field: "costUSD", label: "Spend" },
    "passRate",
  ]}
/>
```

MetricValue 显示本地化值、samples / total 与证据入口。
只有一条证据时直接显示链接；多条证据收成一个带数量的原生展开入口，读者需要时再展开具体 Attempt，不让链接清单撑宽指标列。
普通标量按实际类型显示。字段缺失或行形状不一致时，错误指出 `rows[index].field`。

排序、过滤与 limit 只改变显示行，不重新聚合。
需要改变分组或合并长尾时回到 Sample 调用 `aggregate()`。

## 两面的形态

web 面输出真实 `<table>`；text 面输出[数据格框](../../library/layout.md#数据格框table-与-grid)：外框、列边界与表头横线，把每个读数关进自己的格子。
两面消费同一份 rows，并保持同一行序、列序与终值。

```text
╭─────────────────────────────────┬───────────┬─────────╮
│ Experiment                      │ Pass rate │ Cost    │
├─────────────────────────────────┼───────────┼─────────┤
│ compare/codex-gpt-5.6-luna      │      100% │ $0.29   │
│   toggl-cli/04-billing-doc      │         — │ $0.03   │
│     ✓ @1nesor3r                 │         — │ $0.03   │
╰─────────────────────────────────┴───────────┴─────────╯
```

表宽跟随可用列数全宽，不夹紧到 100 显示列。
列宽取各列内容的自然显示宽度；放不下时按自然宽的比例压缩左对齐的文本列到可读下限，数字列不压，压过的格子在格内折行、行高取该行最高的那一格。
所有文本列都到下限仍放不下，才从右侧丢列并在表下报出丢了几列。
子行的层级靠首列缩进与 `└─` 表达，横线只分隔表头与正文、不逐行切割。

表放进 `Section` 时不画自己的外框，只保留列边界与表头横线——边界由面板的框给出。
非 TTY 或窄于 60 列时格线整体消失，降为按列对齐的纯文本，字段、顺序与数值逐字不变。

## Content 协议

组合组件与内建投影不走普通 rows，直接产出 TableContent 交给同一份双面实现：一份列集加一棵行树，行经 `subRows` 逐层嵌套，`variant` 标记 group 与 placeholder 行。

行形状与列集同源：每一行（含 group、placeholder 与各层子行）的 cells key 集合等于列集。对这一行不适用的列显式填 notApplicable 格，不靠缺格回落成 `—`。写了列集外的 key，或漏掉一个声明列，都按完整用户反馈报错，错误指到行 key 与列 key。

表头长在列声明上。列声明可携带 `header`（LocalizedText），text 与 web 两面按当前 locale 从同一份表头取对应语言，不各自另取；未声明 `header` 的列按 key 原样显示——维度值列（条件名、实验 id 这类列名即数据的列）用这一支。
`Table` 自身不携带任何列名词表，不认识 entity、passRate 这类具体列名；同一个 key 在不同投影里可以有不同表头。

公开 rows 形态的表头同一规则：默认原样显示字段名，传 `label` 替换。

## 相关阅读

- [组件目录](../README.md)
- [Library · Table](../../library.md#table)
