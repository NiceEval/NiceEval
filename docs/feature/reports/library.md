# Reports —— 库用法

`niceeval/report` 的公开模型有三类对象：

- `sources.*` 与 `defineSource(...)` 负责计算可复用的 Content；
- `defineComposition(...)` 拿到运行期 page input，编排多个 Source 并加工 Content；
- `Table`、`Chart` 与 `defineComponent(...)` 负责把一份 Content 显示成 text / web。

`SampleOverview`、`AttemptDetail` 等官方 Composition 兼任裸跑时的具名默认装配。

`niceeval/report/react` 只导出原语的纯 web renderer 与可序列化 Content 类型。它不导出数据源、
组合组件或任何会读取 Record 与 artifact 的代码。

## 按问题选择

| 想回答的问题 | 数据源或组合组件 | 原语 |
|---|---|---|
| 当前 Sample 整体怎样 | `SampleOverview` | 组合组件自行装配 |
| 每个 Experiment、Eval 或 Attempt 发生了什么 | `sources.entity.experiments / evals / attempts` | `Table` |
| 多个读数怎样随一个维度变化 | `sources.measure.rows(...)` | `Table` |
| 哪道 Eval 在哪个条件上异常 | `sources.measure.matrix(...)` | `Table` |
| 固定题集的总分与分科得分 | `sources.measure.scoreboard(...)` | `Table` |
| A 与 B 的成对差异是多少 | `sources.measure.delta(...)` | `Table` |
| 哪些 Eval 的历史从未稳定 | `sources.measure.stability(...)` | `Table` |
| Sample 有多大、判定构成怎样 | `SampleSummary`（组合 snapshot 与 Measure） | `Grid` / `Stat` |
| Sample 选择与 Run 诊断有什么问题 | `SampleNotices` / `RunNotices` | `Callouts` |
| 一次 Attempt 的完整证据 | `AttemptDetail` | 组合组件自行装配 |

完整数据源目录见[数据源](components/sources/README.md),原语边界见[组件树](components/README.md)。

## 在 `show` 与 `view` 中使用

报告文件默认导出 `defineReport(...)`。原语的 `source` 形态接收数据源;`input` 省略时,解析管线注入
宿主已经选择好的 Sample:

```tsx
import {
  Chart,
  Col,
  Series,
  Section,
  Table,
  costUSD,
  defineReport,
  passRate,
  sources,
} from "niceeval/report";

const qualityCost = sources.measure.rows({
  dimensions: ["experiment", "agent"],
  measures: [costUSD, passRate],
});

export default defineReport(
  <Col>
    <Section title="质量与成本">
      <Chart source={qualityCost} x="costUSD" y="passRate" legend tooltip>
        <Series id="frontier" mark="scatter" points="experiment" by="agent" />
      </Chart>
    </Section>
    <Table source={sources.entity.experiments} filter />
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

Source 是计算前的声明，`data` 是计算后的 Content。Record 和 Sample 不提供 Source；
`niceeval/report` 导出的 Source 消费它们提供的明确输入：

```text
Record ── currentSample / latestRunSample ──▶ Sample ── Source.compute ──▶ Content
```

```ts
type SourceInput = Sample | AttemptEvidence;

interface Source<Input extends SourceInput, Content> {
  readonly name: string;
  compute(input: Input): Promise<Content>;
}

function defineSource<Input extends SourceInput, Content>(
  definition: Source<Input, Content>,
): Source<Input, Content>;
```

只有这一种协议，而且 Source 只查询 `.niceeval`：输入限定为 Sample / AttemptEvidence，不能请求外部 API
或接收任意业务对象。表格 Source 把默认 columns 与 rows 一起放进 `TableContent`；`defineSource(...)`
保留传入对象引用，只提供类型推导与定义期反馈，不注册 Source，也不改变 page 级缓存边界。

无需配置的数据源直接导出值:

```ts
await sources.entity.experiments.compute(sample);
await sources.sample.snapshot.compute(sample);
```

需要维度或读数的数据源导出同名工厂:

```ts
const byAgent = sources.measure.rows({
  dimensions: ["agent"],
  measures: [passRate, costUSD],
  sort: passRate,
});

const content = await byAgent.compute(sample);
```

工厂只建立声明，不读 Record。`compute()` 才可能经 Sample 中的 `AttemptHandle` 懒加载 artifact，
因此只在构建脚本、CI、报告 resolve 阶段或能打开记录根的 Node 进程中调用。需要完整历史的数据源
仍接收 Sample，并读取其 `historyAttempts`；组件不会从 `ctx.record` 再做一次选择。`TableContent`、
keyed rows 与完整自定义示例见[Source 目录](components/sources/README.md#写一个-source)。

## 用普通 JavaScript 加工

需要过滤、截断或自定义排序时,先调用数据源的 `compute()`,再把修改后的 Content 交给原语的
`data` 形态:

```tsx
import { Table, defineComposition, sources } from "niceeval/report";

export const CostliestAttempts = defineComposition(
  async ({ limit = 10 }: { limit?: number }, ctx) => {
    const content = await ctx.resolve(sources.entity.attempts);
    const rows = [...content.rows]
      .sort((a, b) => (b.costUSD ?? -Infinity) - (a.costUSD ?? -Infinity))
      .slice(0, limit);

    return <Table data={{ ...content, rows }} filter />;
  },
);
```

原始 Content 与派生 Content 都是普通可序列化值。修改 rows 不会重新定义读数口径；需要在聚合前
收窄 Eval 时，在 Source options 或显式 input 中声明，Component props 不承担计算筛选。

需要内建原语表达不了的新形状时，使用 `defineComponent({ dimensions, enhance, text, web })`。
两个 renderer 消费同一份 Content；要编排多个 Source 时用 `defineComposition`，不在组件里重新取数。
报告树内先在 `dimensions()` 里声明维度与编码，renderer 用 `ctx.dimension(handle).at(index)`
取回身份、页内唯一标签与视觉编码。
自有 React 页面用 `presentDimension(declaration)` 传入同形状的声明。
完整规则见[维度呈现](library/layout.md#维度呈现)。

## 嵌入自己的 React 页面

自己的页面没有 niceeval resolve 阶段。先在服务端计算 Content,再交给
`niceeval/report/react` 的纯原语:

```tsx
import { openRecord } from "niceeval/record";
import { currentSample } from "niceeval/sample";
import {
  costUSD,
  notices,
  passRate,
  sources,
} from "niceeval/report";
import { Callouts, Grid, Stat, Table } from "niceeval/report/react";

export default async function EvalsPage() {
  const record = await openRecord(".niceeval");
  const sample = currentSample(record, { experiments: "compare/" });
  const rows = sources.measure.rows({
    dimensions: ["experiment"],
    measures: [passRate, costUSD],
    sort: passRate,
  });

  const [snapshot, table] = await Promise.all([
    sources.sample.snapshot.compute(sample),
    rows.compute(sample),
  ]);

  return (
    <main>
      <Grid>
        <Stat label="Experiments" value={snapshot.scope.experiments} />
        <Stat label="Attempts" value={snapshot.scope.attempts} />
      </Grid>
      <Callouts data={notices.sample(snapshot)} />
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
const byAgent = sources.measure.rows({
  dimensions: ["agent"],
  measures: [passRate, costUSD],
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

- [组件树](components/README.md) —— 数据源、渲染组件、管线与组合组件。
- [数据源目录](components/sources/README.md) —— 官方数据源全集。
- [读数与维度](library/measures.md) —— `Measure`、`Dimension` 与聚合口径。
- [完整示例](library/examples.md) —— 按场景组织的可复制报告。
- [外壳与多页](library/shell.md) —— page、导航与静态资产。
- [主题](library/theme.md) —— web 呈现令牌与 CSS 出口。
