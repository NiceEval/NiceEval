# 官方 Experiment Report（实验报告）

契约单源始终在 [Report Library](../library.md) 与 Analysis Library。本文只展示官方 Experiment Report 怎样把既有 query、组件、页面和 route 组合成完整阅读路径，不复述类型定义。

## 用户目标

评估完成后，读者需要先看到总体表现，再比较条件和模型，随后进入一次 Attempt 的时序与追踪，最后查看某条 Evidence。四个页面使用同一个被冻结的选择，因此比较表、详情页和证据页不会形成不同分母。

```text
Overview（概览）
    │  总体值与分组表现
    ▼
Comparison（比较）
    │  同一总体中的模型与条件关系
    ▼
Attempt（尝试）
    │  某一次执行的时序与追踪
    ▼
Evidence（证据）
       对应的有界详情
```

Analysis package 发布下列类型化 query 定义和字段。它决定总体、分母、缺失、关系与 `MeasureResult`，Report 只使用这些定义。

```tsx
import { query } from "niceeval/analysis";
import {
  attemptDirectoryQuery,
  attemptTimelineQuery,
  attemptTraceQuery,
  comparisonQuery,
  condition,
  costUSD,
  duration,
  evidenceDirectoryQuery,
  evidenceViewQuery,
  experimentOverviewQuery,
  model,
  passRate,
} from "./experiment-analysis.js";
import {
  AttemptTimeline,
  Bars,
  definePage,
  definePageFamily,
  defineReport,
  EvidenceDrilldown,
  Grid,
  Scatter,
  Stack,
  Summary,
  Table,
  TraceViewer,
} from "niceeval/report";

const overview = definePage({
  id: "overview",
  route: "/",
  title: "实验概览",

  render: async ({ source }) => {
    const frame = await query(source, experimentOverviewQuery);

    return (
      <Stack>
        <Summary frame={frame} fields={[passRate, duration, costUSD]} />
        <Grid columns={2}>
          <Bars frame={frame} x={model} y={passRate} color={condition} />
          <Table
            frame={frame}
            columns={[model, condition, passRate, duration, costUSD]}
          />
        </Grid>
      </Stack>
    );
  },
});

const comparison = definePage({
  id: "comparison",
  route: "/comparison",
  title: "实验比较",

  render: async ({ source }) => {
    const frame = await query(source, comparisonQuery);

    return (
      <Stack>
        <Table
          frame={frame}
          columns={[model, condition, passRate, duration, costUSD]}
          sort={{ field: passRate, direction: "desc" }}
        />
        <Scatter frame={frame} x={costUSD} y={passRate} color={model} />
      </Stack>
    );
  },
});

const attempts = definePageFamily({
  id: "attempt",

  instances: async ({ source }) =>
    (await query(source, attemptDirectoryQuery)).rows,

  key: row => row.dimensions.attempt.identity,
  route: row => `/attempt/${row.dimensions.attempt.routeKey}`,
  title: row => `Attempt ${row.dimensions.attempt.label}`,

  render: async ({ source, instance }) => {
    const attempt = instance.dimensions.attempt.identity;
    const [timeline, trace] = await Promise.all([
      query(source, attemptTimelineQuery({ attempt })),
      query(source, attemptTraceQuery({ attempt })),
    ]);

    return (
      <Stack>
        <AttemptTimeline view={timeline} />
        <TraceViewer view={trace} />
      </Stack>
    );
  },
});

const evidence = definePageFamily({
  id: "evidence",

  instances: async ({ source }) =>
    (await query(source, evidenceDirectoryQuery)).rows,

  key: row => row.dimensions.evidence.identity,
  route: row => `/evidence/${row.dimensions.evidence.routeKey}`,
  title: row => row.dimensions.evidence.label,

  render: async ({ source, instance }) => {
    const evidence = await query(
      source,
      evidenceViewQuery({ evidence: instance.dimensions.evidence.identity }),
    );

    return <EvidenceDrilldown view={evidence} />;
  },
});

export default defineReport({
  id: "experiment-report",
  pages: [overview, comparison, attempts, evidence],
});
```

## 页面怎样共同工作

Overview 用 `experimentOverviewQuery` 给出总体摘要和分组表。`Summary`、`Bars` 与 `Table` 读取同一个 `SemanticFrame`，所以可用值、partial、空值和问题在每个组件中保持一致。

Comparison 用独立的 `comparisonQuery` 表达合法比较口径。`Table` 负责精确值与分母，`Scatter` 用同一 frame 显示成本和通过率的关系；页面代码不自行计算排名、百分比或新分母。

Attempt family 用 `attemptDirectoryQuery` 的稳定身份展开 route。每个详情页只把该身份交给 Analysis query，并把获得的 `AttemptTimelineView` 与 `TraceView` 交给领域组件。

Evidence family 使用同样的方式展开。`EvidenceDrilldown` 只接收 `EvidenceView`，其中已经有受限内容、媒体类型、截断状态和对应问题；页面不读取 Attachment 或 blob。

## 路由与失败

`attempt.routeKey` 和 `evidence.routeKey` 是 Analysis 提供的稳定页面片段。显示 label 可以改变，route 仍然指向同一份闭合结果。数组位置、显示文字和时间近似值都不能生成详情地址。

某个 Attempt 的 timeline query 或 Trace query 失败时，那个 Attempt 页面形成 `report-page-failed`。Overview、Comparison、其他 Attempt 页面和 Evidence 页面继续闭合。度量的 `partial`、`empty`、`unavailable` 或 `failed` 状态仍在相应 frame 中呈现，不会被写成 Page failure。

## 交付的输入

所有 Page 和 family instance 完成后，Report 得到一棵 `ClosedReportTree`。其中已有 Overview、Comparison、Attempt 和 Evidence 的闭合节点、稳定 route 以及问题身份。Report Host SDK 用同一棵树提供终端、网页和静态站，不重新执行 query 或重算比较口径。

## 用户怎样查看与分享

一次运行后，用户从 `InvocationReceipt` 取得 Run ID，再用 Report 的终端或 Web 呈现面查看：

```sh
niceeval show --run <run-id>
niceeval view --run <run-id>
```

多次运行使用同一个 explicit-runs selection（显式运行选择），不会按时间猜一个结果：

```sh
niceeval show --run <run-a> --run <run-b> --page /comparison
```

静态导出先闭合全部目标 Page，再写自包含目录：

```sh
niceeval view --run <run-id> --out ./report-site --no-open
```

三个呈现面保留相同的 denominator（分母）、`partial`、`missing`、`unsupported`、问题与 Evidence navigation（证据导航）。浏览器和静态站都不直接读取 `.niceeval`。
