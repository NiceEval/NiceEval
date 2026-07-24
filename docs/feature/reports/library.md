# Reports —— 库用法

`niceeval/report` 导出 `defineReport`、`defineComponent`、可交给 `show` / `view` 的双面叶子组件与配套 `*Data` 计算函数，以及 `ExperimentComparison`、`AttemptDetail` 这类只装配叶子的普通组合组件；`niceeval/report/react` 只导出叶子的纯 web renderer 和数据类型，不导出取数代码或 report-only 组合。两个入口的同名叶子组件接收同一份 `data`。`defineReport` 的内容只有 pages：page 可以消费 Scope，也可以声明为按 locator 消费 `AttemptEvidence` 的参数化 page，见[外壳与多页](library/shell.md)和 [Attempt 详情组件](library/attempt-detail.md)。

最快的选择方式：先确定想回答的问题，再选组件。

| 想回答的问题 | 组件 |
|---|---|
| 自由摆放 label、主值与辅助信息组成摘要面板 | [`Grid` / `Stat`](library/layout.md#grid-与-stat) |
| 比较当前 Scope 里的 experiments | [`ExperimentComparison`](library/summaries.md#experimentcomparison) |
| 一个范围有多大、整体是否健康（eval 级或 attempt 级计票） | [`ScopeSummary`](library/summaries.md#scopesummary) |
| 每个 experiment / eval / attempt 发生了什么 | [`ExperimentList` / `EvalList` / `AttemptList`](library/entity-lists.md) |
| 现在有哪些失败要处理、先看哪条 | [`FailureList`](library/entity-lists.md#failurelist) |
| 谁整体更好，多个指标并排比较 | [`MetricTable`](library/metric-views.md#metrictable) |
| 哪道题在哪个配置上失败 | [`MetricMatrix` 或 `MetricBars`](library/metric-views.md#metricmatrix-与-metricbars) |
| 固定题集的总分与分科得分 | [`Scoreboard`](library/metric-views.md#scoreboard) |
| 两个指标之间的取舍 | [`MetricScatter`](library/metric-views.md#metricscatter) |
| 参数变化时指标怎样变化 | [`MetricLine`](library/metric-views.md#metricline) |
| A 与 B 相差多少 | [`DeltaTable`](library/metric-views.md#deltatable) |
| 页首放站点标题、最后运行时间与品牌行 | [`Hero`](library/site-components.md#hero) |
| 这批数据的选择警告（快照未收尾、落盘被跳过） | [`ScopeWarnings`](library/site-components.md#scopewarnings) |
| 哪些真实快照发生过无法归属单行的运行诊断 | [`SnapshotDiagnostics`](library/site-components.md#snapshotdiagnostics) |
| 把全部失败打包成可交给 coding agent 的修复 prompt | [`CopyFixPrompt`](library/site-components.md#copyfixprompt) |
| 每个 attempt 的执行时间瀑布 | [`TraceWaterfall`](library/site-components.md#tracewaterfall) |
| 自定义 locator 打开的参数化 page | [`AttemptDetail`，或 `AttemptSummary`、`AttemptAssessment`、`AttemptTimeline` 等详情组件](library/attempt-detail.md) |

组件之外按任务读分篇：

| 任务 | 页面 |
|---|---|
| 按场景抄一份完整报告文件改起 | [配方](library/recipes.md) |
| 选内置指标、定义自己的指标或分组维度 | [指标与维度](library/metrics.md) |
| 组织报告树、拼自由摘要格、写组合组件或双面组件 | [排版原语与自定义组件](library/layout.md) |
| 加标题、GitHub 链接、页脚，或拆成多页 | [外壳与多页](library/shell.md) |
| 改强调色、状态色、图表色板或完整覆盖 CSS | [主题与 CSS 定制](library/theme.md) |
| 摆 hero、品牌行、警告区、快照诊断区、修复 prompt 或 trace 瀑布 | [站点组件](library/site-components.md) |
| 声明、删减或重排 attempt-input page | [Attempt 详情组件](library/attempt-detail.md) |
| 看裸 `show` / `view` 装载的默认定义怎么写 | [内建报告](library/built-in.md) |

## 两种使用方式

### 交给 `show` / `view` 渲染

报告文件默认导出 `defineReport(报告树)`。树里的官方组件写 **spec 形态**——计算选项直接作为 props，数据来源默认宿主注入的 Scope；组件同时实现 text 和 web 两个面，一份定义可用于两个宿主：

```tsx
// reports/quality-cost.tsx
import {
  Col, ExperimentList, MetricScatter, Section,
  costUSD, defineReport, endToEndPassRate,
} from "niceeval/report";

export default defineReport(
  <Col>
    <Section title="质量与成本">
      <MetricScatter points="experiment" series="agent" x={costUSD} y={endToEndPassRate} />
    </Section>
    <ExperimentList filter />
  </Col>,
);
```

```sh
niceeval show --report reports/quality-cost.tsx
niceeval view --report reports/quality-cost.tsx
```

宿主先按位置参数、`--results`、`--exp` 和 `--fresh` 选择数据，再把 Scope 注入报告；管线在 [resolve 阶段](architecture.md#报告树与两个宿主)并行完成所有组件的取数，作者不写任何取数管道。快照未收尾、落盘不可读等选择警告由 [`ScopeWarnings`](library/site-components.md#scopewarnings) 呈现；属于真实 Snapshot、但无法归属单行的运行诊断由 [`SnapshotDiagnostics`](library/site-components.md#snapshotdiagnostics) 呈现。宿主不在报告树外为两者另设通道，[内建报告](library/built-in.md)的三张 scope-input page 都相邻放置它们（attempt-input page 不重复站点范围信息），自定义报告放不放是作者义务。能定位到行的事实不进任一面板：覆盖缺口是 [`ExperimentList` 的占位行](library/entity-lists.md#experimentlist)，携带与跨快照拼接是行上的[时效标注](library/entity-lists.md#时效标注)，Attempt 事实进入详情。`ScopeSummaryData` 等指标数据不复制警告或诊断。`ScopeWarnings` 按下一步动作聚合闭集 kind；`SnapshotDiagnostics` 按真实 experiment → Snapshot 来源组织开放 code，两者各自的聚合、排序与折叠规则见[组件契约](library/site-components.md)。

取数之后要用普通 JavaScript 加工（filter / slice / 自定义排序）时，写一个[组合组件](library/layout.md#自定义组件)：在里面调 `*Data` 函数、加工数组，再以 **data 形态** 把结果递给组件：

```tsx
// reports/components/costliest-attempts.tsx
import { AttemptList, attemptListData, defineComponent } from "niceeval/report";

export const CostliestAttempts = defineComponent(async ({ limit = 10 }: { limit?: number }, ctx) => {
  const all = await attemptListData(ctx.scope);
  const ranked = [...all].sort((x, y) => (y.costUSD ?? 0) - (x.costUSD ?? 0));
  return <AttemptList data={ranked.slice(0, limit)} total={all.length} />;
});
```

spec 形态与 data 形态的完整契约在 [Architecture · 组件模型](architecture.md#组件模型解析面与渲染面)：spec 形态等价于管线代调同名 `*Data`；data 形态是显式降级口，同一组件同时给出 `data` 与 spec 字段按完整用户反馈报错。

### 嵌入自己的 React 页面

自己的页面没有 niceeval 的 resolve 阶段，因此先在服务端调 `*Data` 计算普通 JSON，再把 `data` 交给 `niceeval/report/react` 的纯组件（该入口只有 data 形态）：

```tsx
import { openResults } from "niceeval/results";
import { MetricTable, ScopeSummary, ScopeWarnings, SnapshotDiagnostics } from "niceeval/report/react";
import {
  costUSD, durationMs, endToEndPassRate,
  metricTableData, scopeSummaryData, snapshotDiagnosticsData,
} from "niceeval/report";

export default async function EvalsPage() {
  const results = await openResults(".niceeval");
  const scope = results.current({ experiments: "compare/" });

  const [diagnostics, summary, table] = await Promise.all([
    snapshotDiagnosticsData(scope),
    scopeSummaryData(scope),
    metricTableData(scope, {
      rows: "experiment",
      columns: [endToEndPassRate, costUSD, durationMs],
      sort: endToEndPassRate,
    }),
  ]);

  return (
    <main>
      <ScopeWarnings data={scope.warnings} />
      <SnapshotDiagnostics data={diagnostics} />
      <ScopeSummary data={summary} />
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

每个数据组件都有同名词根的配套 `*Data` 计算函数，例如 `MetricTable` / `metricTableData`、`ExperimentList` / `experimentListData`——它们是组件解析面的具名形式，spec 形态下由管线代调，data 形态与嵌入场景下由作者手工调。计算函数接受 `ReportInput = Scope | readonly Snapshot[]`，返回可序列化数据；组件渲染面本身不读文件。

`*Data(...)` 可能懒加载 artifact，因此只应在服务端、构建脚本或组合组件里调用。返回值是普通可序列化数据，可写成 JSON 供 SPA 使用：

```ts
const table = await metricTableData(scope, {
  rows: "experiment",
  columns: [endToEndPassRate, costUSD],
});
await writeFile("public/evals.json", JSON.stringify(table));
```

计算产物只代表当时的 Scope。结果根变化后要重新调用对应 `*Data(...)`；纯 React 组件渲染同一份 data 时不再读取磁盘。报告树内的并行由管线保证：同层 spec 形态组件并行取数，同引用 `input` + 深相等 spec 只算一次；自有页面里的多个 `*Data` 调用用 `Promise.all` 并行。

所有指标格子都携带 `samples`、`total` 和完整 attempt `refs`。缺数据不会被填成 0，覆盖率与证据引用也不会因序列化而丢失。用于持久化的组件 data 不带独立 schemaVersion，支持口径是同一 niceeval 版本写读；组件消费 `data` 时校验结构，不符合当前形状按完整用户反馈报错并提示可能的版本漂移——漂移以显式错误浮出，不静默错渲染。

## 相关阅读

- [用例手册](use-case/README.md) —— 按用户问题选报告能力,并划出何时换另一种组件或宿主。
- [配方](library/recipes.md) —— 按场景可整份复制的完整报告文件。
- [概览组件](library/summaries.md) / [实体列表](library/entity-lists.md) / [指标组件](library/metric-views.md) / [站点组件](library/site-components.md) / [Attempt 详情组件](library/attempt-detail.md) —— 组件契约分篇。
- [指标与维度](library/metrics.md) —— 内置指标口径与自定义指标。
- [排版原语与自定义组件](library/layout.md) —— 报告树的组织件、组合组件与 text 排版工具。
- [外壳与多页](library/shell.md) —— 标题、外链、页脚、脚本与 `pages`。
- [内建报告](library/built-in.md) —— 裸宿主装载的定义与升级路径。
- [Show](show.md) —— 终端宿主与证据切面。
- [View](view.md) —— web 宿主与静态导出。
- [Architecture](architecture.md) —— 组件模型、resolve 管线和宿主边界。
- [Results Library](../results/library.md) —— `openResults`、Scope 与 artifact 句柄。
