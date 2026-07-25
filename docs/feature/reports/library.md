# Reports —— 库用法

`niceeval/report` 导出 `defineReport`、`defineComponent`、可交给 `show` / `view` 的双面叶子组件与配套 `*Data` 计算函数，以及 `ExperimentComparison`、`AttemptDetail` 这类只装配叶子的普通组合组件；`niceeval/report/react` 只导出叶子的纯 web renderer 和数据类型，不导出取数代码或 report-only 组合。两个入口的同名叶子组件接收同一份 `data`。`defineReport` 的内容只有 pages：page 可以消费 Sample，也可以声明为按 locator 消费 `AttemptEvidence` 的参数化 page，见[外壳与多页](library/shell.md)和 [Attempt 详情](components/attempt-detail/README.md)。

组件的数据绑定与局部配置写成结构子节点，组合规则单源在[组件树](components/README.md)。最快的选择方式：先确定想回答的问题，再选组件。

| 想回答的问题 | 组件 |
|---|---|
| 自由摆放 label、主值与辅助信息组成摘要面板 | [`Grid` / `Stat`](library/layout.md#grid-与-stat) |
| 写方法学、口径说明、脚注这类散文 | [`Markdown`](library/layout.md#markdown) |
| 比较当前 Sample 里的 experiments | [`ExperimentComparison`](components/summaries/experiment-comparison.md) |
| 一个范围有多大、整体是否健康（eval 级或 attempt 级计票） | [`SampleSummary`](components/summaries/sample-summary.md) |
| 每个 experiment / eval / attempt 发生了什么 | [`ExperimentList` / `EvalList` / `AttemptList`](components/entity-lists/README.md) |
| 现在有哪些失败要处理、先看哪条 | [`FailureList`](components/entity-lists/failure-list.md) |
| 谁整体更好，多个指标并排比较 | [`MetricTable`](components/tables/metric-table.md) |
| 哪道题在哪个配置上失败 | [`MetricMatrix`](components/tables/metric-matrix.md) |
| 固定题集的总分与分科得分 | [`Scoreboard`](components/tables/scoreboard.md) |
| A 与 B 相差多少 | [`DeltaTable`](components/tables/delta-table.md) |
| 哪些题历史上从来没稳过 | [`StabilityMatrix`](components/tables/stability-matrix.md) |
| 两个指标之间的取舍、参数变化时指标怎样变化、排行与堆叠构成 | [图表](components/charts/README.md) |
| 页首放站点标题、最后运行时间与品牌行 | [`Hero`](components/site/hero.md) |
| 这批数据的选择警告（Run 未收尾、落盘被跳过） | [`SampleWarnings`](components/site/sample-warnings.md) |
| 哪些真实 Run 发生过无法归属单行的运行诊断 | [`RunDiagnostics`](components/site/run-diagnostics.md) |
| 把全部失败打包成可交给 coding agent 的修复 prompt | [`CopyFixPrompt`](components/site/copy-fix-prompt.md) |
| 每个 attempt 的执行时间瀑布 | [`TraceWaterfall`](components/site/trace-waterfall.md) |
| 自定义 locator 打开的参数化 page | [`AttemptDetail`，或 `AttemptSummary`、`AttemptAssessment`、`AttemptTimeline` 等详情组件](components/attempt-detail/README.md) |

组件之外按任务读分篇：

| 任务 | 页面 |
|---|---|
| 弄清一个组件收哪些子节点、颜色怎么分配 | [组件树](components/README.md) |
| 按场景抄一份完整报告文件改起 | [配方](library/recipes.md) |
| 选内置指标、定义自己的指标或分组维度 | [指标与维度](library/metrics.md) |
| 组织报告树、拼自由摘要格、写组合组件或双面组件 | [排版原语与自定义组件](library/layout.md) |
| 让自定义组件复现官方的标签缩写与系列色 | [呈现算法](library/layout.md#呈现算法) |
| 加标题、GitHub 链接、页脚，或拆成多页 | [外壳与多页](library/shell.md) |
| 改强调色、状态色、图表色板、字体或完整覆盖 CSS | [主题](library/theme.md) |
| 自己写一个报告组件，并让它跟随任何主题 | [自己写报告组件](use-case/write-custom-component.md) |
| 摆 hero、品牌行、警告区、Run 诊断区、修复 prompt 或 trace 瀑布 | [站点组件](components/site/README.md) |
| 声明、删减或重排 attempt-input page | [Attempt 详情](components/attempt-detail/README.md) |
| 看裸 `show` / `view` 装载的默认定义怎么写 | [内建报告](library/built-in.md) |

## 两种使用方式

### 交给 `show` / `view` 渲染

报告文件默认导出 `defineReport(报告树)`。树里的官方组件写 **spec 形态**——数据绑定写在结构子节点上，数据来源默认宿主注入的 Sample；组件同时实现 text 和 web 两个面，一份定义可用于两个宿主：

```tsx
// reports/quality-cost.tsx
import {
  Col, ExperimentList, Legend, Scatter, ScatterChart, Section, Tooltip, XAxis, YAxis,
  costUSD, defineReport, endToEndPassRate,
} from "niceeval/report";

export default defineReport(
  <Col>
    <Section title="质量与成本">
      <ScatterChart>
        <XAxis metric={costUSD} />
        <YAxis metric={endToEndPassRate} />
        <Tooltip />
        <Legend />
        <Scatter points="experiment" by="agent" x={costUSD} y={endToEndPassRate} />
      </ScatterChart>
    </Section>
    <ExperimentList filter />
  </Col>,
);
```

```sh
niceeval show --report reports/quality-cost.tsx
niceeval view --report reports/quality-cost.tsx
```

宿主先按位置参数、`--record`、`--exp` 和 `--fresh` 选择数据，再把 Sample 注入报告；管线在 [resolve 阶段](architecture.md#报告树与两个宿主)并行完成所有组件的取数，作者不写任何取数管道。Run 未收尾、落盘不可读等选择警告由 [`SampleWarnings`](components/site/sample-warnings.md) 呈现；属于真实 Run、但无法归属单行的运行诊断由 [`RunDiagnostics`](components/site/run-diagnostics.md) 呈现。宿主不在报告树外为两者另设通道，[内建报告](library/built-in.md)的三张 sample-input page 都相邻放置它们（attempt-input page 不重复站点范围信息），自定义报告放不放是作者义务。能定位到行的事实不进任一面板：覆盖缺口是 [`ExperimentList` 的占位行](components/entity-lists/experiment-list.md)，携带与跨 Run 拼接是行上的[时效标注](components/entity-lists/README.md#时效标注)，Attempt 事实进入详情。`SampleSummaryData` 等指标数据不复制警告或诊断。`SampleWarnings` 按下一步动作聚合闭集 kind；`RunDiagnostics` 按真实 experiment → Run 来源组织开放 code，两者各自的聚合、排序与折叠规则见[组件契约](components/site/README.md)。

取数之后要用普通 JavaScript 加工（filter / slice / 自定义排序）时，写一个[组合组件](library/layout.md#自定义组件)：在里面调 `*Data` 函数、加工数组，再以 **data 形态** 把结果递给组件：

```tsx
// reports/components/costliest-attempts.tsx
import { AttemptList, attemptListData, defineComponent } from "niceeval/report";

export const CostliestAttempts = defineComponent(async ({ limit = 10 }: { limit?: number }, ctx) => {
  const all = await attemptListData(ctx.sample);
  const ranked = [...all].sort((x, y) => (y.costUSD ?? 0) - (x.costUSD ?? 0));
  return <AttemptList data={ranked.slice(0, limit)} total={all.length} />;
});
```

spec 形态与 data 形态的完整契约在 [Architecture · 组件模型](architecture.md#组件模型解析面与渲染面)：spec 形态等价于管线代调同名 `*Data`；data 形态是显式降级口，同一组件同时给出 `data` 与 spec 字段按完整用户反馈报错。

### 嵌入自己的 React 页面

自己的页面没有 niceeval 的 resolve 阶段，因此先在服务端调 `*Data` 计算普通 JSON，再把 `data` 交给 `niceeval/report/react` 的纯组件（该入口只有 data 形态）：

```tsx
import { openRecord } from "niceeval/record";
import { latestPerEval } from "niceeval/sample";
import { MetricTable, SampleSummary, SampleWarnings, RunDiagnostics } from "niceeval/report/react";
import {
  costUSD, durationMs, endToEndPassRate,
  metricTableData, sampleSummaryData, runDiagnosticsData,
} from "niceeval/report";

export default async function EvalsPage() {
  const record = await openRecord(".niceeval");
  const sample = latestPerEval(record, { experiments: "compare/" });

  const [diagnostics, summary, table] = await Promise.all([
    runDiagnosticsData(sample),
    sampleSummaryData(sample),
    metricTableData(sample, {
      rows: "experiment",
      columns: [endToEndPassRate, costUSD, durationMs],
      sort: endToEndPassRate,
    }),
  ]);

  return (
    <main>
      <SampleWarnings data={sample.warnings} />
      <RunDiagnostics data={diagnostics} />
      <SampleSummary data={summary} />
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

## 数据计算与缓存边界

每个数据组件都有同名词根的配套 `*Data` 计算函数，例如 `MetricTable` / `metricTableData`、`ExperimentList` / `experimentListData`——它们是组件解析面的具名形式，spec 形态下由管线代调，data 形态与嵌入场景下由作者手工调。计算函数接受 `ReportInput = Sample | readonly Run[]`，返回可序列化数据；组件渲染面本身不读文件。

`*Data(...)` 可能懒加载 artifact，因此只应在服务端、构建脚本或组合组件里调用。返回值是普通可序列化数据，可写成 JSON 供 SPA 使用：

```ts
const table = await metricTableData(sample, {
  rows: "experiment",
  columns: [endToEndPassRate, costUSD],
});
await writeFile("public/evals.json", JSON.stringify(table));
```

计算产物只代表当时的 Sample。记录根变化后要重新调用对应 `*Data(...)`；纯 React 组件渲染同一份 data 时不再读取磁盘。报告树内的并行由管线保证：同层 spec 形态组件并行取数，自有页面里的多个 `*Data` 调用用 `Promise.all` 并行。

### 一份计算给多处用：`data` 块

同一份计算被两个 page 或两个组件消费是常态——实验列表在首页出现一次，明细页再出现一次。内联 spec 各写
一遍时，「这两处是同一份计算吗」只能靠结构深相等去猜；猜中了省一次取数，猜不中默默算两遍，作者
看不出差别。把它**命名**掉，问题就不存在了：

```tsx
export default defineReport({
  data: {
    byAgent: metricTable({ rows: "agent", columns: [endToEndPassRate, costUSD] }),
    quality: scatter({ x: costUSD, y: endToEndPassRate, points: "experiment" }),
  },
  pages: [
    page("overview", <Col><Scatter from="quality" /><MetricTable from="byAgent" /></Col>),
    page("detail", <Col><MetricTable from="byAgent" /></Col>),
  ],
});
```

`data` 的键是名字，值是与内联 spec 同一组构造函数；组件用 `from="<名字>"` 引用。**同一个名字保证
只算一次**，跨 page 也是一次——这是声明出来的，不是推断出来的。名字不存在时在装载期报错，不等到
渲染。

三种取数形态严格等价，终值、覆盖率与 attempt 引用逐字段相同，按「这份计算给几处用」选：

| 形态 | 写法 | 什么时候用 |
|---|---|---|
| 内联 spec | `<MetricTable rows="agent" … />` | 只此一处 |
| 命名 `data` | `data: { byAgent: … }` + `from="byAgent"` | 多处消费同一份 |
| 手工 data | `await metricTableData(sample, …)` → `data={…}` | 取数后要用普通 JS 加工 |

命名 `data` 的键同时是缓存键与调试锚点:`--json` 输出与错误信息按名字点出是哪份计算失败,不用让
作者从一棵树里数第几个组件。这套「命名查询 + 组件按名引用」抄自 Evidence.dev,见
[参考方案](reference/README.md#evidencedev--命名查询与构建时取数)。

所有指标格子都携带 `samples`、`total` 和完整 attempt `refs`。缺数据不会被填成 0，覆盖率与证据引用也不会因序列化而丢失。用于持久化的组件 data 不带独立 schemaVersion，支持口径是同一 niceeval 版本写读；组件消费 `data` 时校验结构，不符合当前形状按完整用户反馈报错并提示可能的版本漂移——漂移以显式错误浮出，不静默错渲染。

## 相关阅读

- [用例手册](use-case/README.md) —— 按用户问题选报告能力,并划出何时换另一种组件或宿主。
- [配方](library/recipes.md) —— 按场景可整份复制的完整报告文件。
- [组件树](components/README.md) —— 组合模型、子节点资格总表与页级色分配。
- [图表](components/charts/README.md) / [表格与矩阵](components/tables/README.md) / [实体列表](components/entity-lists/README.md) / [概览](components/summaries/README.md) / [Attempt 详情](components/attempt-detail/README.md) / [站点组件](components/site/README.md) —— 组件契约分篇。
- [指标与维度](library/metrics.md) —— 内置指标口径与自定义指标。
- [排版原语与自定义组件](library/layout.md) —— 报告树的组织件、组合组件与 text 排版工具。
- [外壳与多页](library/shell.md) —— 标题、外链、页脚、脚本与 `pages`。
- [内建报告](library/built-in.md) —— 裸宿主装载的定义与升级路径。
- [Show](show.md) —— 终端宿主与证据切面。
- [View](view.md) —— web 宿主与静态导出。
- [Architecture](architecture.md) —— 组件模型、resolve 管线和宿主边界。
- [Record Library](../record/library.md) —— `openRecord`、Sample 与 artifact 句柄。
