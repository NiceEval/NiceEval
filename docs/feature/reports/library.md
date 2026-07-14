# Reports —— 库用法

`niceeval/report` 用来计算报告数据和定义可同时交给 `show`、`view` 渲染的报告；`niceeval/report/react` 提供可直接嵌入你自己 React 页面中的纯渲染组件。

最快的选择方式：先确定想回答的问题，再选组件。

| 想回答的问题 | 组件 |
|---|---|
| 这批结果有多大、整体是否健康 | `RunOverview` |
| 某一组 experiment 的整体情况 | `GroupSummary` |
| 每个 experiment / eval / attempt 发生了什么 | `ExperimentList` / `EvalList` / `AttemptList` |
| 谁整体更好，多个指标并排比较 | `MetricTable` |
| 哪道题在哪个配置上失败 | `MetricMatrix` 或 `MetricBars` |
| 固定题集的总分与分科得分 | `Scoreboard` |
| 两个指标之间的取舍 | `MetricScatter` |
| 参数变化时指标怎样变化 | `MetricLine` |
| A 与 B 相差多少 | `DeltaTable` |

## 两种使用方式

### 交给 `show` / `view` 渲染

报告文件默认导出 `defineReport(...)`。报告中的官方组件同时实现 text 和 web 两个面，一份定义可用于两个宿主：

```tsx
// reports/quality-cost.tsx
import {
  Col,
  ExperimentList,
  MetricScatter,
  Section,
  costUSD,
  defineReport,
  taskPassRate,
} from "niceeval/report";

export default defineReport(async ({ selection }) => {
  const experiments = await ExperimentList.data(selection);

  return (
    <Col>
      <Section title="质量与成本">
        <MetricScatter
          selection={selection}
          points="experiment"
          series="agent"
          x={costUSD}
          y={taskPassRate}
        />
      </Section>
      <ExperimentList items={experiments} filter />
    </Col>
  );
});
```

```sh
niceeval show --report reports/quality-cost.tsx
niceeval view --report reports/quality-cost.tsx
```

宿主先按位置参数、`--run` 和 `--experiment` 选择数据，再把 `selection` 注入报告。覆盖不完整、快照过旧或未完成等警告由宿主统一显示，报告不必自己补警告组件。

### 嵌入自己的 React 页面

自己的页面没有 niceeval 的异步解析阶段，因此先在服务端计算普通 JSON，再把 `data` 交给纯组件：

```tsx
import { openResults } from "niceeval/results";
import { MetricTable, RunOverview } from "niceeval/report/react";
import { costUSD, durationMs, taskPassRate } from "niceeval/report";

export default async function EvalsPage() {
  const results = await openResults(".niceeval");
  const selection = results.latest({ experiments: "compare/" });

  const [overview, table] = await Promise.all([
    RunOverview.data(selection),
    MetricTable.data(selection, {
      rows: "experiment",
      columns: [taskPassRate, costUSD, durationMs],
      sort: taskPassRate,
    }),
  ]);

  return (
    <main>
      <RunOverview data={overview} />
      <MetricTable
        data={table}
        filter
        attemptHref={(locator) => `/attempts/${locator}`}
      />
    </main>
  );
}
```

组件输出完整静态 HTML。网页排序、过滤和图表 tooltip 是渐进增强；需要官方样式与增强脚本时引入 `niceeval/report/react/styles.css` 和 `niceeval/report/react/enhance.js`。

## 组件目录

每个组件都把配套计算函数挂在 `.data` 上。计算函数接受 `Selection` 或 `Snapshot[]`，返回可序列化数据；组件本身不读文件。

### 概览组件

#### `ExperimentComparison`

裸 `niceeval show` 与 `niceeval view` 首页渲染的内置默认报告：先是成本 × 成功率散点（`MetricScatter` 的口径），再是 `ExperimentList`。它是官方维护的组合件而非新的数据源——两个子块消费与单独使用时完全相同的 `.data()` 计算结果；只有一个可画 experiment 时散点照常显示单点。在自定义报告里可以整体引用它，也可以直接摆两个子组件得到同样的数据口径：

```tsx
<ExperimentComparison data={await ExperimentComparison.data(selection)} />
```

#### `RunOverview`

显示快照时间、experiment / eval / attempt 数、通过率、总成本和 Selection 警告。适合作为报告页头。

```tsx
<RunOverview data={await RunOverview.data(selection)} />
```

#### `GroupSummary`

显示一个范围内的 experiment / eval / attempt 数、eval 级判定构成、通过率、成本和最后运行时间。先过滤 Selection，再计算摘要：

```tsx
const group = selection.filter((snapshot) => snapshot.experimentId.startsWith("compare/"));
<GroupSummary data={await GroupSummary.data(group)} />
```

### 实体列表

实体列表用于从汇总下钻到事实，不允许自由配置列。固定列不等于所有渲染面使用相同排版：web 面可以用表格支持人工比较，text 面可以用紧凑列表支持终端阅读，但两面必须消费同一份 `.data()` 结果。

#### `ExperimentList`

每项显示 experiment 身份、agent / model、flags、判定构成、官方指标和其中的 eval。适合总览页的主列表。

web 面是固定列的 experiment 比较表，而不是无表头的松散卡片列表。主表一行一个 experiment，列顺序固定为：

| 列 | 内容 |
|---|---|
| Experiment | experiment id；副行显示 eval 数、attempt 数（多于 eval 数时）和最后运行时间 |
| Model | model；缺失时显示明确空值 |
| Agent | agent |
| Avg duration | 官方 `durationMs` 聚合值 |
| Pass rate | 官方 `taskPassRate` 聚合值；默认按此列从高到低排序 |
| Tokens | 官方 `tokens` 聚合值 |
| Est. cost | 官方 `costUSD` 聚合值 |
| Result | passed / failed / errored / skipped 的 eval 级判定构成 |

表头支持点击排序；`filter` 为 web 面增加过滤输入框，可按 experiment、agent、model、flag 或 eval 文本收窄行。排序和过滤只改变浏览状态，不改变数据、指标口径或 text 面输出。每个 experiment 行使用原生 `<details>` 展开，展开区显示 flags 和 Eval 列表；每个 Eval 下把全部 Attempt 逐条列出，每条显示判定、locator、耗时 / 成本或失败原因，可继续下钻到 Attempt 详情。

text 面先输出与 web 同口径的八列 experiment 比较表，再按 experiment 输出 Eval / Attempt 明细表。Eval 是父行，不是 Attempt 行上的重复字段；Attempt 用 `├─` / `└─` 子行显示一对多关系。明细列固定为状态、Eval / Attempt、结果、耗时、成本；窄终端复用标准 text table renderer 折行或从右侧隐藏低优先级列，并明确报告隐藏列数：

```text
Experiment      Model          Agent   Avg duration   Pass rate   Result                  Tokens   Est. cost
compare/codex   gpt-5.4-mini   codex   1m 12s        50%         1 passed / 1 failed     42k      $0.08

compare/codex
Status      Eval / Attempt       Result                       Duration   Cost
✓ passed    algebra/retry
  ✗         ├─ @1first01         equals(42)                   16.0s      $0.02
  ✓         └─ @1second2         —                            18.2s      $0.02
✗ failed    weather/tool
  ✗         └─ @1third03         calledTool("get_weather")   42.1s      $0.04
```

窄屏允许表格横向滚动，不能为了适应宽度删除列、把多个无标签数值挤成一串，或退化成无法判断各数字含义的无表头布局。

```tsx
const items = await ExperimentList.data(selection);
<ExperimentList
  items={items.filter((x) => x.experimentId.startsWith("prod/"))}
  filter
/>
```

#### `EvalList`

每项表示 `experimentId + evalId`，显示折叠判定、失败原因、分数、耗时、成本和全部 attempt。

```tsx
const items = await EvalList.data(selection);
<EvalList items={items.filter((x) => x.verdict !== "passed")} />
```

#### `AttemptList`

每项显示一次 attempt 的判定、断言、结构化错误的一层摘要、Judge 证据和 locator。diagnostics/cause/stack 属于 locator 下钻详情,不塞进比较列表。适合做“最近失败”或“待处理失败”区块。

```tsx
const all = await AttemptList.data(selection, {
  redact: (text) => text.replaceAll(/sk-[A-Za-z0-9]+/g, "[redacted]"),
});
const failed = all.filter((x) => x.verdict === "failed" || x.verdict === "errored");

<AttemptList items={failed.slice(0, 20)} total={failed.length} />
```

`redact` 处理 error 的 message/cause/stack、diagnostic message/data、断言 detail 和 evidence；experimentId、evalId、locator、error/diagnostic code 与 lifecycle operation 等身份和分类字段不会被改写。它是**展示层遮蔽**——只作用于这次计算产出的组件数据，不改变盘上或任何导出目录里的 artifact；发布 artifact 的消毒用 [`copySnapshots({ redact })`](../results/library.md#复制与瘦身copysnapshots)，两者的改写范围约定一致。

### 指标组件

#### `MetricTable`

一行一个维度值，一列一个指标。适合 benchmark 榜和配置比较。`sort` 决定初始顺序，方向由指标的 `better` 决定；`filter` 给 web 面增加行过滤框。

```tsx
<MetricTable data={await MetricTable.data(selection, {
  rows: "agent",
  columns: [taskPassRate, examScore, costUSD, durationMs],
  sort: taskPassRate,
  evals: "coding/",
})} filter />
```

#### `MetricMatrix` 与 `MetricBars`

二者使用同一份矩阵数据：Matrix 适合看“题 × 配置”的格子，Bars 适合比较每行的相对大小。

```tsx
const data = await MetricMatrix.data(selection, {
  rows: "eval",
  columns: "agent",
  cell: taskPassRate,
});

<MetricMatrix data={data} />
<MetricBars data={data} />
```

矩阵是稀疏的：没有 attempt 的组合不生成格子。格子中的 `refs` 保留证据引用；在自有页面中传 `attemptHref` 可令格子跳到你的 attempt 页。

#### `Scoreboard`

把 eval 当题目，按固定题集算总分和分科得分。没跑到的题保留在分母中并按 0 分计，适合考试或合规检查，不适合“只统计有数据样本”的探索分析。

```tsx
<Scoreboard data={await Scoreboard.data(selection, {
  rows: "agent",
  subjects: "evalGroup",
  weights: { "security/": 3, "correctness/": 2 },
  fullMarks: 100,
  score: examScore,
})} />
```

权重按 eval id 前缀匹配；多个前缀都命中时，最长前缀生效。

#### `MetricScatter`

每个点是一个维度值，x / y 各一个指标，series 决定连线分组。适合质量 × 成本 frontier。

在 `defineReport` 中可以直接给 Selection：

```tsx
<MetricScatter
  selection={selection}
  points="experiment"
  series="agent"
  x={costUSD}
  y={taskPassRate}
/>
```

在自己的 React 页面中先计算：

```tsx
const data = await MetricScatter.data(selection, {
  points: "experiment",
  series: "agent",
  x: costUSD,
  y: taskPassRate,
});
<MetricScatter data={data} pointHref={(row) => `/experiments/${row.key}`} />
```

x 或 y 缺失的点不绘制，并显示缺失数量。零个可画点时组件显示明确空态；只有一个可画点时照常画出该点，不把“比较”错误地当成至少两个实验的门槛。

#### `MetricLine`

用一个数值 flag 作为 x 轴，按 series 画指标趋势。适合 token budget、并发数、reasoning effort 等参数扫描。

```tsx
import { flag } from "niceeval/report";

<MetricLine data={await MetricLine.data(selection, {
  x: flag("budget", { label: "Token budget", unit: "tokens" }),
  series: "agent",
  y: taskPassRate,
})} />
```

没有声明该 flag 或 flag 不是数值的 experiment 不会伪造 x 值，组件会报告未绘制数量。

#### `DeltaTable`

成对比较 A 与 B，并按指标的 `better` 判断 delta 是改善还是退化。适合基线 / 候选、无缓存 / 有缓存或两个快照的对比。

```tsx
<DeltaTable data={await DeltaTable.data(selection, {
  pairs: [
    { label: "memory", a: "baseline", b: "with-memory" },
  ],
  metrics: [taskPassRate, costUSD, durationMs],
})} />
```

任一侧缺数据时 delta 保持缺失，不把缺失当 0。

## 指标

### 内置指标

| 指标 | 含义 | 越高/低越好 | 数据来源 |
|---|---|---|---|
| `taskPassRate` | Agent 答题质量：passed = 1，failed = 0，**errored 记 `null` 不进分母**——基础设施故障不伪装成 Agent 答错 | 高 | `result.json` |
| `executionReliability` | 基建可靠性：跑到可判定（passed / failed）= 1，errored = 0 | 高 | `result.json` |
| `endToEndPassRate` | 端到端合成：passed = 1，failed / errored = 0；哪边拖累用上面两个拆开看 | 高 | `result.json` |
| `examScore` | gate 决定能否得分，soft 断言给质量分 | 高 | `result.json` |
| `durationMs` | attempt 判定链耗时（不含收尾段，口径见 [Results](../results/architecture.md#resultjson)） | 低 | `result.json` |
| `tokens` | input + output tokens | 低 | `result.json` |
| `costUSD` | 网关实测成本优先，否则估算成本 | 低 | `result.json` |
| `turns` | assistant turn 数 | 低 | `o11y.json` |

`skipped` 对这些指标返回 `null`。`turns` 需要 `o11y.json`；发布时没复制该 artifact 就显示缺失，不会冒充 0。

### 自定义指标

```ts
import { defineMetric } from "niceeval/report";

export const changedLines = defineMetric({
  name: "changed-lines",
  label: { en: "Changed lines", "zh-CN": "改动行数" },
  unit: "lines",
  better: "lower",
  where: (attempt) => attempt.result.verdict === "passed",
  async value(attempt) {
    const diff = await attempt.diff();
    if (!diff) return null;
    return Object.keys(diff.files)
      .reduce((sum, path) => sum + (diff.get(path) ?? "").split("\n").length, 0);
  },
  aggregate: { perEval: "min", across: "mean" },
});
```

- `null` 表示测不了，不进入聚合；`0` 表示测得结果为零，会正常进入聚合。
- `where` 是进入计算前的显式条件，适合“只比较通过方案的代码量”。
- 聚合先在同一 eval 的多个 attempt 之间折叠，再跨 eval 折叠；两级默认都是 `mean`。
- `unit` 驱动内置格式化；需要特殊显示时提供 `display(value)`。

## 维度与 flags

可直接使用的维度有 `agent`、`model`、`experiment`、`eval`、`evalGroup` 和 `snapshot`。

自定义维度：

```ts
const verdictFamily = {
  name: "verdict-family",
  of: (attempt) => attempt.result.verdict === "passed" ? "pass" : "needs-work",
};
```

experiment 中声明的变量用 `flag()` 读取，不从 experiment id 字符串猜。`flag()` 只读 `ExperimentDef.flags` 里显式声明的 KV：

```ts
const memory = flag("memory", { label: "Memory mode" });
```

`model`、`reasoningEffort`、`budget`、`runs` 这类**顶层运行配置不在 `flags` 里**，用 `config()` 读快照的 [`ExperimentRunInfo`](../results/architecture.md#snapshotjson) 投影——可用键是那张接口的字段全集，外加桥接到快照顶层权威字段的 `model` / `agent` 两个键：

```ts
const reasoning = config("reasoningEffort", { label: "Reasoning effort" });
const budget = config("budget", { label: "Budget", unit: "USD" });
```

两者都可当分组维度或数值轴；未声明 / 未投影的值归到 `(unset)`，作为数值轴时则不绘点并报告缺失。

## 数据计算与缓存边界

`.data(...)` 可能懒加载 artifact，因此应在服务端、构建脚本或 `defineReport` 的异步函数中调用。返回值是普通可序列化数据，可写成 JSON 供 SPA 使用：

```ts
const table = await MetricTable.data(selection, {
  rows: "experiment",
  columns: [taskPassRate, costUSD],
});
await writeFile("public/evals.json", JSON.stringify(table));
```

计算产物只代表当时的 Selection。结果根变化后要重新调用 `.data(...)`；纯 React 组件渲染同一份 data 时不再读取磁盘。对于同一页面需要的多个组件，可用 `Promise.all` 并行计算。

所有指标格子都携带 `samples`、`total` 和 attempt `refs`。缺数据不会被填成 0，覆盖率与证据引用也不会因序列化而丢失。

## 排版原语

`Row`、`Col`、`Section`、`Text`、`Style` 和 `Table` 是六个内置双面组件，用于组织报告树：

```tsx
return (
  <Col>
    <Text>nightly benchmark</Text>
    <Row>
      <Section title="Overall">...</Section>
      <Section title="Failures">...</Section>
    </Row>
    <Style>{`.nre .team-note { color: #6b7280; }`}</Style>
  </Col>
);
```

### `Table`

自定义表格的标准件：给一份 `columns` 和 `rows`，text 面按显示宽度对齐、web 面输出 `<table>`。

```tsx
<Table
  columns={[
    { key: "eval", header: "题目" },
    { key: "pass", header: "通过率", align: "right" },
    { key: "cost", header: "成本", align: "right" },
  ]}
  rows={[
    {
      key: "memory/写缓存",
      locator: "@160iuj3h",
      cells: { eval: "memory/写缓存", pass: "87%", cost: "$0.09" },
    },
    {
      key: "memory/读缓存",
      cells: { eval: "memory/读缓存", pass: null, cost: null },
    },
  ]}
/>
```

`TableProps`：

| Prop | 类型 | 含义 |
|---|---|---|
| `columns` | `TableColumn[]` | 列定义；数组顺序即渲染顺序 |
| `rows` | `TableRow[]` | 行数据；数组顺序即渲染顺序 |
| `locale` | `ReportLocale` | 组件自带文案的语言；省略时随宿主 |
| `className` | `string` | web 面挂在 `<table>` 上 |

`TableColumn`：

| 字段 | 类型 | 含义 |
|---|---|---|
| `key` | `string` | 取 `row.cells[key]` 的键 |
| `header` | `string` | 表头文案，原样渲染 |
| `align` | `"left" \| "right"` | 默认 `"left"`；`"right"` 按显示宽度右对齐，数字列用 |

`TableRow`：

| 字段 | 类型 | 含义 |
|---|---|---|
| `key` | `string` | 行身份 |
| `cells` | `Record<string, string \| null>` | 已格式化的显示值 |
| `locator` | `AttemptLocator` | 可选；带上就多一列 attempt |

渲染契约：

- **列宽按显示宽度算**，CJK / 全角记 2 列。中文列不会撕歪。
- **`null` 渲染成 `—`**，不补 0；`cells` 里缺这个键同样是 `—`。
- **超宽先折行再丢列。** 总宽超过可用列宽时，先压最宽的左对齐列（按显示宽度折行）；右对齐列不折行——数字折行读不了。左对齐列压到下限仍放不下，就从右侧丢列，并在表下如实标注丢了几列。
- **两个面各自成立。** text 面列间 3 空格、首行表头；web 面是 `<table>` + `<thead>` / `<tbody>`，右对齐落成 `nre-align-right` 类，不用内联样式。
- **带 `locator` 的行接证据室。** 有任一行带 `locator` 时多出一列 attempt：web 面是指向证据室的链接，text 面列出 locator（`niceeval show <locator>` 的位置参数）。

`MetricTable`、`MetricMatrix`、`Scoreboard` 和 `DeltaTable` 的 text 面建在 `Table` 上：自定义表和官方表用同一把尺子。

## 文本排版工具箱

表格之外的形态要自己写 text 面时，用 `niceeval/report` 导出的这组纯函数。不要用 `String.prototype.padEnd` / `padStart` 对齐：它们数的是 UTF-16 码元，不是终端显示列宽，agent 名或 eval id 一带中文，整张表就撕歪。

| 导出 | 签名 | 用途 |
|---|---|---|
| `stringWidth` | `(text: string) => number` | 显示宽度：CJK / 全角记 2 列，其余 1 列 |
| `padEnd` | `(text: string, width: number) => string` | 按显示宽度在右侧补齐（左对齐） |
| `padStart` | `(text: string, width: number) => string` | 按显示宽度在左侧补齐（右对齐，数字列用） |
| `wrapText` | `(text: string, width: number) => string[]` | 按显示宽度折行 |
| `indent` | `(block: string, prefix: string) => string` | 每行加缩进 |
| `bar` | `(ratio: number, width: number) => string` | 字符条：`█` 填充、`░` 补齐到 `width` |
| `columns` | `(blocks: string[], widths: number[], separator?: string) => string` | 多块并排 |

## 自定义组件

要让自定义组件同时出现在 `show` 和 `view`，用 `defineComponent` 同时提供 `web` 与 `text` 面。只服务自己网页的组件直接写普通 React 组件即可。

## 相关阅读

- [Show](show.md) —— 终端宿主与证据切面。
- [View](view.md) —— web 宿主与静态导出。
- [Architecture](architecture.md) —— 报告树、异步解析和宿主边界。
- [Results Library](../results/library.md) —— `openResults`、Selection 与 artifact 句柄。
