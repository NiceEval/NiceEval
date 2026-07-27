# Reports —— 库用法

`niceeval/report` 导出三类公开对象:

- `Table`、`Grid`、`Callouts`、图表等双面原语,负责内容形状;
- `experimentRows`、`measureRows(...)`、`sampleSummary(...)` 等数据源,负责领域计算;
- `SampleOverview`、`AttemptDetail` 等组合组件,负责默认装配。

`niceeval/report/react` 只导出原语的纯 web renderer 与可序列化 Content 类型。它不导出数据源、
组合组件或任何会读取 Record 与 artifact 的代码。

## 按问题选择

| 想回答的问题 | 数据源或组合组件 | 原语 |
|---|---|---|
| 当前 Sample 整体怎样 | `SampleOverview` | 组合组件自行装配 |
| 每个 Experiment、Eval 或 Attempt 发生了什么 | `experimentRows` / `evalRows` / `attemptRows` | `Table` |
| 多个读数怎样随一个维度变化 | `measureRows(...)` | `Table` |
| 哪道 Eval 在哪个条件上异常 | `measureMatrix(...)` | `Table` |
| 固定题集的总分与分科得分 | `scoreboard(...)` | `Table` |
| A 与 B 的成对差异是多少 | `deltaRows(...)` | `Table` |
| 哪些 Eval 的历史从未稳定 | `stabilityRows(...)` | `Table` |
| Sample 有多大、判定构成怎样 | `sampleSummary(...)` | `Grid` |
| Sample 选择与 Run 诊断有什么问题 | `sampleWarnings` / `runDiagnostics` | `Callouts` |
| 一次 Attempt 的完整证据 | `AttemptDetail` | 组合组件自行装配 |

完整数据源目录见[数据源](components/sources/README.md),原语边界见[组件树](components/README.md)。

## 在 `show` 与 `view` 中使用

报告文件默认导出 `defineReport(...)`。原语的 `source` 形态接收数据源;`input` 省略时,解析管线注入
宿主已经选择好的 Sample:

```tsx
import {
  Chart,
  Col,
  Section,
  Table,
  chart,
  costUSD,
  defineReport,
  endToEndPassRate,
  experimentRows,
} from "niceeval/report";

const qualityCost = chart({
  x: { measure: costUSD },
  y: { measure: endToEndPassRate },
  series: [{
    key: "frontier",
    mark: "scatter",
    points: "experiment",
    by: "agent",
    x: costUSD,
    y: endToEndPassRate,
  }],
});

export default defineReport(
  <Col>
    <Section title="质量与成本">
      <Chart source={qualityCost} legend tooltip />
    </Section>
    <Table source={experimentRows} filter />
  </Col>,
);
```

```sh
niceeval show --report reports/quality-cost.tsx
niceeval view --report reports/quality-cost.tsx
```

宿主先按 `--record`、`--exp`、Eval 位置参数与 `--fresh` 选择 Sample,再解析报告。数据源并行计算,
原语的 text 与 web 两面消费同一份 Content。

## 数据源与计算结果

数据源是计算前的声明，`data` 是计算后的内容。Record 和 Sample 不提供 DataSource；
`niceeval/report` 导出的 DataSource 消费它们提供的明确输入：

```text
Record ── currentSample / latestRunSample ──▶ Sample ── DataSource.compute ──▶ Content
```

```ts
interface DataSource<Content, Input = Sample> {
  readonly name: string;
  compute(input: Input): Promise<Content>;
}
```

无需配置的数据源直接导出值:

```ts
await experimentRows.compute(sample);
await sampleSummary().compute(sample);
```

需要维度或读数的数据源导出同名工厂:

```ts
const byAgent = measureRows({
  rows: "agent",
  measures: [endToEndPassRate, costUSD],
  sort: endToEndPassRate,
});

const content = await byAgent.compute(sample);
```

工厂只建立声明，不读 Record。`compute()` 才可能经 Sample 中的 `AttemptHandle` 懒加载 artifact，
因此只在构建脚本、CI、报告 resolve 阶段或能打开记录根的 Node 进程中调用。需要完整历史的数据源
显式接收 `readonly Run[]`；组合组件从 `ctx.record` 选择后用 `input` 传入。Table 专用的
`RowSource`、keyed rows 与完整自定义示例见[数据源目录](components/sources/README.md#写一个数据源)。

## 用普通 JavaScript 加工

需要过滤、截断或自定义排序时,先调用数据源的 `compute()`,再把修改后的 Content 交给原语的
`data` 形态:

```tsx
import { Table, attemptRows, defineComponent } from "niceeval/report";

export const CostliestAttempts = defineComponent(
  async ({ limit = 10 }: { limit?: number }, ctx) => {
    const content = await attemptRows.compute(ctx.sample);
    const rows = [...content.rows]
      .sort((a, b) => (b.costUSD ?? -Infinity) - (a.costUSD ?? -Infinity))
      .slice(0, limit);

    return <Table data={{ ...content, rows }} filter />;
  },
);
```

原始 Content 与派生 Content 都是普通可序列化值。修改 rows 不会重新定义读数口径;需要在聚合前收窄
Eval 时,使用原语 source 形态的 `evals` 选项。

## 嵌入自己的 React 页面

自己的页面没有 niceeval resolve 阶段。先在服务端计算 Content,再交给
`niceeval/report/react` 的纯原语:

```tsx
import { openRecord } from "niceeval/record";
import { currentSample } from "niceeval/sample";
import {
  costUSD,
  endToEndPassRate,
  measureRows,
  runDiagnostics,
  sampleSummary,
  sampleWarnings,
} from "niceeval/report";
import { Callouts, Grid, Table } from "niceeval/report/react";

export default async function EvalsPage() {
  const record = await openRecord(".niceeval");
  const sample = currentSample(record, { experiments: "compare/" });
  const rows = measureRows({
    rows: "experiment",
    measures: [endToEndPassRate, costUSD],
    sort: endToEndPassRate,
  });

  const [summary, warnings, diagnostics, table] = await Promise.all([
    sampleSummary().compute(sample),
    sampleWarnings.compute(sample),
    runDiagnostics.compute(sample),
    rows.compute(sample),
  ]);

  return (
    <main>
      <Grid data={summary} />
      <Callouts data={warnings} />
      <Callouts data={diagnostics} />
      <Table data={table} filter />
    </main>
  );
}
```

产品运行时看不见记录根时,在构建脚本中把 Content 写成 JSON。部署后的页面只 import
`niceeval/report/react`;证据下钻需要同时用 [`publish()`](../record/library.md#发布publish)
发布对应 Record 子集。

## 复用同一份数据源

同一份声明被多个 page 消费时，直接复用同一个 TypeScript source 值。报告外壳没有 source 注册表，
原语也不接受字符串绑定：

```tsx
const byAgent = measureRows({
  rows: "agent",
  measures: [endToEndPassRate, costUSD],
});

export default defineReport({
  pages: [
    { id: "overview", title: "Overview", content: <Table source={byAgent} /> },
    { id: "detail", title: "Detail", content: <Table source={byAgent} filter /> },
  ],
});
```

同一 page 实例内，相同 source 对象与相同 input 引用只计算一次。不同 page 独立 resolve，
所以一页失败不会污染另一页。需要跨文件复用时具名导出 `byAgent` 再 import，不增加第二套注册协议。

## 相关阅读

- [组件树](components/README.md) —— 原语、数据源、管线与组合组件。
- [数据源目录](components/sources/README.md) —— 官方数据源全集。
- [读数与维度](library/measures.md) —— `Measure`、`Dimension` 与聚合口径。
- [完整示例](library/examples.md) —— 按场景组织的可复制报告。
- [外壳与多页](library/shell.md) —— page、导航与静态资产。
- [主题](library/theme.md) —— web 呈现令牌与 CSS 出口。
