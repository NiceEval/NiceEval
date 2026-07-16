# Reports —— 库用法

`niceeval/report` 用来计算报告数据和定义可同时交给 `show`、`view` 渲染的报告；`niceeval/report/react` 提供可直接嵌入你自己 React 页面中的纯渲染组件。单棵报告树装不下时，报告文件可以升级成带导航外壳的多页站点，见[站点](#站点多页与导航外壳)。

最快的选择方式：先确定想回答的问题，再选组件。

| 想回答的问题 | 组件 |
|---|---|
| 这批结果有多大、整体是否健康 | `RunOverview` |
| 按可比组看当前水位，并只在组内比较 | `ExperimentComparison` |
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
  endToEndPassRate,
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
          y={endToEndPassRate}
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

宿主先按位置参数、`--run` 和 `--experiment` 选择数据，再把 `selection` 注入报告。覆盖不完整、快照过旧或未完成等警告由宿主统一显示，报告不必自己补警告组件。显示时下一步随行：text 面原样打印 `message`（[三段式](../../error-feedback.md#消息三段式)，已含下一步），web 面额外把警告的 `command` 渲染为可复制的命令。

### 嵌入自己的 React 页面

自己的页面没有 niceeval 的异步解析阶段，因此先在服务端计算普通 JSON，再把 `data` 交给纯组件：

```tsx
import { openResults } from "niceeval/results";
import { MetricTable, RunOverview } from "niceeval/report/react";
import { costUSD, durationMs, endToEndPassRate } from "niceeval/report";

export default async function EvalsPage() {
  const results = await openResults(".niceeval");
  const selection = results.latest({ experiments: "compare/" });

  const [overview, table] = await Promise.all([
    RunOverview.data(selection),
    MetricTable.data(selection, {
      rows: "experiment",
      columns: [endToEndPassRate, costUSD, durationMs],
      sort: endToEndPassRate,
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

裸 `niceeval show` 与 `niceeval view` 首页渲染的内置默认报告。它先把 Selection 按**可比组**分区，再为每组分别计算 `GroupSummary`、成本 × 端到端成功率散点（`MetricScatter` 的口径）和 `ExperimentList`。可比组键是 experiment id 的完整父路径：`compare/bub` 与 `compare/codex` 的键都是 `compare`，`bench/long/codex` 的键是 `bench/long`；没有父路径的 experiment 使用自己的完整 id 作为单例组键。不同组的数据不会进入同一个 scatter、series、排序或汇总。

端到端成功率把每个 `failed` 与 `errored` attempt 都记为 0，只有 `skipped` 不进聚合；默认首页因此回答“这套配置实际交付成功结果的概率”，不会因排除执行错误而抬高排名。它是官方维护的组合件而非新的数据源——每个组的三个子块消费与单独使用时完全相同的 `.data()` 计算结果；某组只有一个可画 experiment 时散点照常显示单点。web 面持有完整组索引并一次聚焦一组，无 JS 时退化为各组独立的 `<details>`；text 面命中多个组时只显示组索引与可执行的单组查看命令，命中单组时才输出完整散点与列表，绝不生成跨组总榜。

在自定义报告里可以整体引用它：

```tsx
<ExperimentComparison data={await ExperimentComparison.data(selection)} />
```

数据形状穷尽如下：

```ts
interface ExperimentComparisonData {
  groups: ExperimentComparisonGroupData[];
}

interface ExperimentComparisonGroupData {
  /** experiment id 的完整父路径；根目录 experiment 使用自己的完整 id。 */
  key: string;
  summary: GroupSummaryData;
  scatter: ScatterData;
  experiments: ExperimentListItem[];
}
```

组按 `key` 字典序排列；组内 experiment 按端到端成功率从高到低预排。自定义报告若直接组合 `MetricScatter` / `ExperimentList`，就是在显式接管分区责任：通用组件忠实消费传入范围，不会自动把跨组 Selection 拆开。

#### `RunOverview`

显示快照时间、experiment / eval / attempt 数、端到端成功率、总成本和 Selection 警告。适合作为报告页头。成功率使用官方 `endToEndPassRate` 两级聚合；`errored` 记 0，`skipped` 不进分母。

```tsx
<RunOverview data={await RunOverview.data(selection)} />
```

#### `GroupSummary`

显示一个范围内的 experiment / eval / attempt 数、eval 级判定构成、端到端成功率、成本和最后运行时间。先过滤 Selection，再计算摘要。这里先把同一 eval 的多轮 attempt 折成一个 verdict，再计算 `passed / (passed + failed + errored)`；`skipped` 不进分母：

```tsx
const group = selection.filter((snapshot) => snapshot.experimentId.startsWith("compare/"));
<GroupSummary data={await GroupSummary.data(group)} />
```

### 实体列表

实体列表用于从汇总下钻到事实，不允许自由配置列。固定列不等于所有渲染面使用相同排版：web 面可以用表格支持人工比较，text 面可以用紧凑列表支持终端阅读，但两面必须消费同一份 `.data()` 结果。

#### `ExperimentList`

每项显示 experiment 身份、agent / model、flags、判定构成、官方指标和其中的 eval。适合一个可比组内的主列表。组件本身是通用实体列表，不推断组边界；默认 `ExperimentComparison` 每次只把一组 items 交给它，自定义报告若传入多组 items 就是在明确选择跨组列表。

web 面是固定列的 experiment 比较表，而不是无表头的松散卡片列表。主表一行一个 experiment，列顺序固定为：

| 列 | 内容 |
|---|---|
| Experiment | experiment id；副行显示 eval 数、attempt 数（多于 eval 数时）和最后运行时间。传 `relativeTo` 时行标签去掉与该父路径相同的前缀，只显示 id 末段（与同组散点的点标签同源）；完整 id 仍用于排序键、着色和折叠展开 |
| Model | model；缺失时显示明确空值 |
| Agent | agent |
| Avg duration | 官方 `durationMs` 聚合值 |
| End-to-end pass rate | 官方 `endToEndPassRate` 聚合值；默认按此列从高到低排序 |
| Tokens | 官方 `tokens` 聚合值 |
| Est. cost | 官方 `costUSD` 聚合值 |
| Result | passed / failed / errored / skipped 的 eval 级判定构成 |

表头支持点击排序；`filter` 为 web 面增加过滤输入框，可按 experiment、agent、model、flag 或 eval 文本收窄行。排序和过滤只改变浏览状态，不改变数据、指标口径或 text 面输出。每个 experiment 行使用原生 `<details>` 展开，展开区显示 flags 和 Eval 列表。Eval 父行只显示折叠判定、Attempt 数以及这道题的平均耗时 / 平均成本；每个 Attempt 子行再显示该轮判定、locator、耗时 / 成本与 [Scoring 定义的主失败断言摘要](../scoring/library/display.md#主失败断言怎样选)，可继续下钻到 Attempt 详情。父行不复述某一轮的失败原因：单轮时会与唯一子行重复，多轮时挑任一轮又会冒充 Eval 级事实。passed attempt 的 Result 是 `—`，不罗列通过的 assertions。

`relativeTo` 是可选的父路径：设置后每行只显示相对该路径的 id 末段，避免在已经以组为标题的上下文里重复文件夹名。默认 `ExperimentComparison` 给每组的 `ExperimentList` 传入组键（experiment id 的父目录），因此 web 与 text 两面组内各行显示末段而非完整 `组/末段`，与同组散点的点标签保持一致；根目录单例组的 id 不含该前缀，照原样显示完整 id。独立使用 `ExperimentList` 且不传 `relativeTo` 时始终显示完整 id。无论显示形态如何，排序键、着色、过滤匹配和折叠展开都用完整 id，不受影响。

text 面先输出与 web 同口径的八列 experiment 比较表，再按 experiment 输出 Eval / Attempt 明细表。Eval 是父行，不是 Attempt 行上的重复字段；Attempt 用 `├─` / `└─` 子行显示一对多关系。明细列固定为状态、Eval / Attempt、结果、耗时、成本；窄终端复用标准 text table renderer 折行或从右侧隐藏低优先级列，并明确报告隐藏列数：

```text
Experiment      Model          Agent   Avg duration   E2E pass rate   Result                  Tokens   Est. cost
compare/codex   gpt-5.4-mini   codex   1m 12s        50%         1 passed / 1 failed     42k      $0.08

compare/codex
Status      Eval / Attempt       Result                       Duration   Cost
✓ passed    algebra/retry                                      17.1s avg   $0.02 avg
  ✗         ├─ @1first01         equals(42) · expected 42, received 41   16.0s   $0.02
  ✓         └─ @1second2         —                            18.2s      $0.02
✗ failed    weather/tool                                      42.1s avg   $0.04 avg
  ✗         └─ @1third03         calledTool("get_weather") · received 2 other calls   42.1s   $0.04
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

每项表示 `experimentId + evalId`。父行显示折叠判定、Attempt 数、聚合分数、平均耗时和平均成本，展开后由每个 Attempt 子行分别显示该轮的主失败摘要或结构化错误摘要。比较层不展开全部 assertions，也不在 Eval 父行复述某个 Attempt 的失败内容。

```tsx
const items = await EvalList.data(selection);
<EvalList items={items.filter((x) => x.verdict !== "passed")} />
```

#### `AttemptList`

每项显示一次 attempt 的判定、主失败断言摘要或结构化错误的一层摘要、Judge 分数和 locator。完整 assertions、Judge evidence、diagnostics、cause 与 stack 属于 locator 下钻详情，不塞进比较列表。适合做“最近失败”或“待处理失败”区块。

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
  columns: [endToEndPassRate, examScore, costUSD, durationMs],
  sort: endToEndPassRate,
  evals: "coding/",
})} filter />
```

#### `MetricMatrix` 与 `MetricBars`

二者使用同一份矩阵数据：Matrix 适合看“题 × 配置”的格子，Bars 适合比较每行的相对大小。

```tsx
const data = await MetricMatrix.data(selection, {
  rows: "eval",
  columns: "agent",
  cell: endToEndPassRate,
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
  y={endToEndPassRate}
/>
```

在自己的 React 页面中先计算：

```tsx
const data = await MetricScatter.data(selection, {
  points: "experiment",
  series: "agent",
  x: costUSD,
  y: endToEndPassRate,
});
<MetricScatter data={data} pointHref={(row) => `/experiments/${row.key}`} />
```

x 或 y 缺失的点不绘制，并显示缺失数量。零个可画点时组件显示明确空态；只有一个可画点时照常画出该点，不把“比较”错误地当成至少两个实验的门槛。

web 面每个点带直接标签，内容是 experiment id 的末段（完整 id 与两轴取值在悬停提示里）——frontier 图靠“哪个点是谁”回答问题，标签必须逐一可读，不能只靠图例配色。标签位置从该点四周由近及远的一圈候选位（左右紧邻、四个斜角、正上正下，逐环外扩）中择优：代价累加「与已放置标签的重叠、与任何数据点的重叠、越出画布的面积、离点距离」，取最小者。只要存在无冲突候选，标签就不遮盖任何数据点、不与其它标签重叠、不越出画布；全部候选都冲突时取重叠最小的一个，绝不静默丢标签。无冲突时首选点右侧紧邻位；标签落在左右紧邻位之外时补一条 leader line 连回原点。多个点重合或近乎重合时，各自的标签向不同方向散开、各自带 leader line，每个仍能独立读出对应的点。

`MetricScatter` 是通用分析组件，不根据 experiment id 隐式分区。默认 `ExperimentComparison` 会先按可比组过滤后逐组调用它；自定义报告直接传入跨组 Selection 时，跨组同图是作者的显式选择。

#### `MetricLine`

用一个数值 flag 作为 x 轴，按 series 画指标趋势。适合 token budget、并发数、reasoning effort 等参数扫描。

```tsx
import { flag } from "niceeval/report";

<MetricLine data={await MetricLine.data(selection, {
  x: flag("budget", { label: "Token budget", unit: "tokens" }),
  series: "agent",
  y: endToEndPassRate,
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
  metrics: [endToEndPassRate, costUSD, durationMs],
})} />
```

任一侧缺数据时 delta 保持缺失，不把缺失当 0。

## 指标

### 内置指标

| 指标 | 含义 | 越高/低越好 | 数据来源 |
|---|---|---|---|
| `endToEndPassRate` | 默认成功率：passed = 1，failed / errored = 0，回答实际交付成功结果的概率 | 高 | `result.json` |
| `taskPassRate` | 条件答题通过率：passed = 1，failed = 0，errored 记 `null`；即只在已形成可信判定的样本上回答 Agent 答题质量 | 高 | `result.json` |
| `executionReliability` | 执行可靠性：跑到可判定（passed / failed）= 1，errored = 0；回答一次运行能否形成可信判定 | 高 | `result.json` |
| `examScore` | gate 决定能否得分，soft 断言给质量分 | 高 | `result.json` |
| `durationMs` | attempt 判定链耗时（不含收尾段，口径见 [Results](../results/architecture.md#resultjson)） | 低 | `result.json` |
| `tokens` | input + output tokens | 低 | `result.json` |
| `costUSD` | 网关实测成本优先，否则估算成本 | 低 | `result.json` |
| `turns` | assistant turn 数 | 低 | `o11y.json` |

`skipped` 对这些指标返回 `null`。`errored` 只在 `taskPassRate` 中返回 `null`，在默认 `endToEndPassRate` 与 `executionReliability` 中都返回 0。三个指标都遵守“先在同一 eval 的 attempts 内聚合，再跨 eval 聚合”的两级规则；每个 eval 只有一个 attempt 时，`endToEndPassRate` 才简化为 `passed / (passed + failed + errored)`。三个指标必须按名字展示：任何默认总览和任何只写“Pass rate / 成功率”的位置都使用 `endToEndPassRate`；`taskPassRate` 必须标成“Task pass rate / 可判定任务通过率”等条件口径，不能把 `2 passed / 5 errored` 显示成无条件的 `100%`。要定位损失来自答题还是执行，可把三列并排：

```tsx
<MetricTable data={await MetricTable.data(selection, {
  rows: "experiment",
  columns: [endToEndPassRate, taskPassRate, executionReliability],
  sort: endToEndPassRate,
})} />
```

`turns` 需要 `o11y.json`；发布时没复制该 artifact 就显示缺失，不会冒充 0。

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
  columns: [endToEndPassRate, costUSD],
});
await writeFile("public/evals.json", JSON.stringify(table));
```

计算产物只代表当时的 Selection。结果根变化后要重新调用 `.data(...)`；纯 React 组件渲染同一份 data 时不再读取磁盘。对于同一页面需要的多个组件，可用 `Promise.all` 并行计算。

所有指标格子都携带 `samples`、`total` 和 attempt `refs`。缺数据不会被填成 0，覆盖率与证据引用也不会因序列化而丢失。

## 排版原语

`Row`、`Col`、`Section`、`Text`、`Style`、`Tabs` 和 `Table` 是七个内置双面组件，用于组织报告树：

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

### `Tabs`

把一页里的并列视图组织成可切换的块。tab 是页内浏览状态，不是数据边界，也不是宿主寻址单位——需要能从 CLI 单独打开、有自己路由和导航项的块，用[站点页](#站点多页与导航外壳)而不是 tab。

```tsx
<Tabs>
  <Tab title="质量 × 成本">
    <MetricScatter selection={selection} points="experiment" series="agent" x={costUSD} y={endToEndPassRate} />
  </Tab>
  <Tab title="分科得分">
    <Scoreboard data={scoreboard} />
  </Tab>
</Tabs>
```

- 两个渲染面都输出全部 tab 的完整内容。web 面静态 HTML 把每个 tab 渲染为独立 `<details>`，第一个默认展开；渐进增强把它们变成单选 tab 条。切换是纯浏览状态，不改变数据、指标口径或初始 HTML 中的数值。text 面按声明顺序把每个 tab 输出为带标题的分节。
- `Tab` 只有 `title: string` 一个属性。tab 不参与路由，没有 id，也没有 CLI 选择器。

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

## 站点：多页与导航外壳

`--report` 文件的默认导出有两种形状：`defineReport(...)` 产出一棵报告树，填进宿主默认外壳的报告槽；`defineSite(...)` 产出一份站点定义——若干个报告页，加一层导航外壳（站点标题、外部链接、页脚、自定义脚本与样式）。要发布带品牌和 GitHub 链接的 benchmark 站、或把成绩单与趋势分成独立页面时，用站点：

```tsx
// reports/site.tsx
import { defineReport, defineSite, ExperimentComparison } from "niceeval/report";
import exam from "./exam.tsx"; // 已有的 defineReport 文件直接复用为一页

export default defineSite({
  title: { en: "Memory Evals", "zh-CN": "记忆能力评测" },
  links: [
    { label: "GitHub", href: "https://github.com/you/coding-agent-memory-evals" },
    { label: { en: "CI", "zh-CN": "CI" }, href: "https://github.com/you/repo/actions" },
  ],
  footer: { en: "Published nightly from CI.", "zh-CN": "由 CI 每晚发布。" },
  scripts: [{ src: "./assets/annotate.js" }],
  styles: [{ inline: ".nre .nre-hero { letter-spacing: 0.02em; }" }],
  pages: [
    {
      id: "overview",
      title: { en: "Overview", "zh-CN": "总览" },
      report: defineReport(async ({ selection }) => (
        <ExperimentComparison data={await ExperimentComparison.data(selection)} />
      )),
    },
    { id: "exam", title: { en: "Exam", "zh-CN": "成绩单" }, report: exam },
  ],
});
```

```sh
niceeval view --report reports/site.tsx              # 完整站点，首页是第一页
niceeval show --report reports/site.tsx              # 多页时输出页索引
niceeval show --report reports/site.tsx --page exam  # 渲染指定页
```

字段穷尽如下：

```ts
interface SiteDef {
  /** 站点标题：浏览器标题、导航品牌与首页 hero。取值链是 site.title → 快照 name → "NiceEval"。 */
  title?: LocalizedText;
  /** 导航右侧的外部链接，如 GitHub、文档、CI。 */
  links?: SiteLink[];
  /** 每页页脚的一段文字；省略则无页脚。 */
  footer?: LocalizedText;
  /** 注入每个页面的脚本，在官方增强脚本之后、按声明顺序于 </body> 前加载。 */
  scripts?: SiteAsset[];
  /** 注入每个页面的样式表，在官方样式之后按声明顺序加载。 */
  styles?: SiteAsset[];
  /** 报告页，导航按数组顺序显示；省略时站点只有一页内置 ExperimentComparison。 */
  pages?: SitePage[];
}

interface SitePage {
  /** 页面身份：`--page <id>` 的取值、web 路由 `#/page/<id>` 与导航锚。小写字母、数字与连字符，站点内唯一。 */
  id: string;
  /** 导航中的页名。 */
  title: LocalizedText;
  /** 这一页的报告；每页接受宿主注入的同一份 Selection。 */
  report: ReportDefinition;
}

interface SiteLink {
  label: LocalizedText;
  href: string;
}

/** src 是相对站点文件所在目录的资产路径；inline 是原样注入的脚本或样式正文。 */
type SiteAsset = { src: string } | { inline: string };
```

站点的行为约束：

- **页是宿主寻址单位，tab 是页内浏览状态。** 页有 id、路由、导航项和 `--page` 选择器；[`Tabs`](#tabs) 没有。需要单独打开、深链或在终端独立渲染的内容做成页，同页内的并列视图用 tab。
- **所有页共享同一份 Selection。** 位置参数与 `--experiment` 收窄对全站生效；页是对同一批数据的不同看法，不承担数据过滤职责。要看不同数据范围，用命令行收窄或在页的报告里显式 filter。
- **除 `title` 外的外壳字段是 web 面属性。** `links`、`footer`、`scripts`、`styles` 只被 `view` 与静态导出消费；`show` 读同一文件时消费 `pages`，并把 `title` 用作页索引的标题行。外壳文案是 `LocalizedText`，随外壳的语言切换取值。
- **自定义脚本是增强层。** 与官方增强脚本同一不变量：初始静态 HTML 无 JS 时完整可读，脚本只添加浏览行为，不改变数据、指标口径或初始 HTML 中的数值。要改数据口径，改的是报告树或指标定义，不是脚本。
- **`{src}` 资产按路径纪律解析。** 允许普通相对路径和 `./` 前缀，不允许 `..` 路径段、绝对路径或 `~`；本地 `view` 直接提供这些文件，静态导出把它们复制进导出目录的 `assets/` 并保持相对路径。引用的文件缺失时在启动或导出时报错并给出解析后的路径。
- **校验在装载时完成。** 重复或非法的 page id、缺任一渲染面的页内组件，都在宿主装载站点时以完整用户反馈报错，不渲染半套站点。
- **脚本随站点发布。** 静态导出会原样携带并在读者浏览器执行 `scripts`；[`--out` 的数据等级防呆](view.md#静态导出)只检查证据文件的消毒标记，不检查脚本内容，脚本里别嵌密钥。

## 相关阅读

- [Show](show.md) —— 终端宿主与证据切面。
- [View](view.md) —— web 宿主与静态导出。
- [Architecture](architecture.md) —— 报告树、异步解析和宿主边界。
- [Results Library](../results/library.md) —— `openResults`、Selection 与 artifact 句柄。
