# Langfuse 读取与比较

> 观察日期：2026-08-14
>
> 核对源码：`langfuse/langfuse` `7cc6d2c0`；文档仓 `d0a5f34e`
>
> 返回 [目录](README.md)

本页写已经写入的事实怎样被重开、查询、对齐、比较和画出。
持久表与信封归 [storage.md](storage.md)。
旧读取端点何时 404 见 [schema-and-migration.md](schema-and-migration.md)。

## 重开入口

普通用户不打开 ClickHouse 或对象存储。
官方入口是项目 UI、Public API 与 SDK 的 `api.*` 客户端。

Next.js pages 在 `web/src/pages/project/[projectId]/`。

| 用户要看什么 | 路由 |
|---|---|
| 全部 Observation | `/project/{id}/observations` |
| 一条 Trace 树 | `/project/{id}/traces/{traceId}` |
| Session | `/project/{id}/sessions/{sessionId}` |
| Dataset 与 item | `/project/{id}/datasets`、`/datasets/{datasetId}` |
| 一次 DatasetRun | `/project/{id}/datasets/{datasetId}/runs/{runId}` |
| 多次实验比较 | `/project/{id}/datasets/{datasetId}/compare` |
| 项目级 Experiment 列表 | `/project/{id}/experiments` |
| Score 列表与分析 | `/project/{id}/scores`、`/scores/analytics` |
| Widget / Dashboard | `/project/{id}/widgets`、`/dashboards/{dashboardId}` |
| Home | `/project/{id}`；可把任意 Dashboard 设为 Home |
| Annotation queue | `/project/{id}/annotation-queues/{queueId}` |
| 平台 evaluator | `/project/{id}/evals` |

v4 主探索面是 Observations 表。
默认过滤 `Is Root Observation = true`，每条 Trace 只显示一行。
去掉该过滤就能看全部步骤。
`trace_id` 与 `session_id`、`user_id` 一样只是过滤列。
见 [UI changes](https://langfuse.com/self-hosting/upgrade/upgrade-guides/upgrade-v3-to-v4#ui-changes)。

SDK 实验成功后给出：

```text
{base}/project/{project_id}/datasets/{dataset_id}/runs/{dataset_run_id}
```

这是重新打开该次 DatasetRun 的深链。

API resource 与 Fern 文件的完整索引见 [storage.md](storage.md#api-resource)。
本页只解释这些读取端点的请求和比较语义。

## query 与 filter

### Observations v2

Fern：`fern/apis/server/definition/observations.yml`。

字段组：`core` 始终返回；另可选 `basic`、`time`、`io`、`metadata`、`model`、`usage`、`prompt`、`metrics`、`trace_context`。
未指定时返回 `core` 与 `basic`。
未请求的组在响应中缺席，不是 `null`。
`io` 是原始字符串。
`parseIoAsJson=true` 返回 400。
`metadata` 默认截到 200 字符；`expandMetadata` 取完整键。
`metrics` 组返回读取时算出的 `latency` 与 `timeToFirstToken`。

过滤可以走 query 参数，或走 JSON `filter` 数组。
`filter` 优先于单个 query 参数。

`isRootObservation` 包含两类行：没有物理父节点，以及 SDK 标成 app root 的行。
后者的 `parentObservationId` 可以非空。

结果按 `startTime` 降序。
`limit` 默认 50，最大 1000。

```python
observations = langfuse.api.observations.get_many(
    trace_id="abcdef1234",
    type="GENERATION",
    limit=100,
    fields="core,basic,usage",
)
```

见 [Query via SDKs](https://langfuse.com/docs/api-and-data-platform/features/query-via-sdk#observations)。

### Scores v3

`GET /api/public/v3/scores` 的 `value` 随 `dataType` 变化：
NUMERIC 是 number，BOOLEAN 是 boolean，其余是 string。

可选字段组：`details`、`subject`、`annotation`。
`subject.kind` 是 `trace`、`observation`、`session`、`experiment`。

`traceId`、`sessionId`、`observationId`、`experimentId` 互斥。
`observationId` 必须同时给 `traceId`。

### Experiments API

列表与 item 都要求 `fromStartTime`。
这是 scale-aware 契约：必须带时间范围。

`fields` 控制返回组。
Experiment 默认 `core`；item 默认 `core,dataset`。

`ExperimentItem` 同时带 `id`、`traceId`、`experimentId`、`experimentItemId`。
`input` / `output` / `expectedOutput` 在 `fields=io` 时出现。
item 级与 Trace 级 Score 在 `fields=scores` 时出现。
实验级 Score 只出现在 `GET /experiments`。

过滤列：`id`、`name`、`datasetId`（实验）；`experimentId`、`experimentName`、`experimentItemId`、`datasetId`（item）。

`startTime` / `endTime` / `itemCount` 按请求时间范围聚合，会随 `fromStartTime` 裁剪。

Session 没有专用读取端点。
按 `sessionId` 拉 Observation 后在客户端分组。

## group

`GET /api/public/v2/metrics` 的 `query` 是一段 JSON。
见 [Metrics API](https://langfuse.com/docs/metrics/features/metrics-api) 与 `fern/apis/server/definition/metrics.yml`。

v2 view：`observations`、`scores-numeric`、`scores-boolean`、`scores-categorical`。
`traces` view 已删除。
要数 Trace，过滤 `isRootObservation = true`。

```json
{
  "view": "observations",
  "metrics": [{"measure": "totalCost", "aggregation": "sum"}],
  "dimensions": [{"field": "providedModelName"}],
  "filters": [],
  "fromTimestamp": "2025-05-01T00:00:00Z",
  "toTimestamp": "2025-05-13T00:00:00Z"
}
```

`dimensions` 就是 group。
常见键是 model、user、time、trace name、score name。
高基数身份键可过滤，不可分组：`id`、`traceId`、`userId`、`sessionId`、`parentObservationId`、`observationId`。
违反返回 400。

聚合函数：`sum`、`avg`、`count`、`max`、`min`、`p50`、`p75`、`p90`、`p95`、`p99`、`histogram`。
时间粒度：`auto`、`minute`、`hour`、`day`、`week`、`month`。
`auto` 大约切成 50 个桶。
默认行数 100，最大 1000。

查询引擎的 view 声明在 `packages/shared/src/features/query/dataModel.ts`。
v4 Widget 默认走 v2，从 events 模型派生 traces。
旧 Widget 怎样继续读取见 [schema-and-migration.md](schema-and-migration.md#兼容-reader)。

## align 与 compare

Langfuse 没有名为 align 的 API。
对齐发生在 Dataset item 身份上。

官方假设每个 Dataset item 在一次实验里只出现一次。
比较页把多次 DatasetRun 按同一 `datasetItemId` 排成列。
UI 路由是 `/datasets/{datasetId}/compare`。
重复样本见 [#5855](https://github.com/langfuse/langfuse/issues/5855)。

changelog 写：rebuilt interface shows visual deltas for scores, cost, and latency。
也可以按阈值过滤，把回归项筛出来。
见 [Experiments rebuild](https://langfuse.com/changelog/2026-04-13-experiments-rebuild)。

项目级 `/experiments` 把不同数据源的实验放进同一列表。
数据源可以是 Dataset、生产 Trace，或 SDK 本地数组。
本地数组没有 DatasetRun，比较能力弱于 Dataset 实验。

`DatasetItem.sourceTraceId` / `sourceObservationId` 允许从题面回到生产 Observation。
这是 lineage 导航，不是按文本对齐。

## render

写入 API 不接受图表参数。
图表在读取侧创建。

作者路径：Dashboards → Widgets → 选 data source、metrics、dimensions、filters、chart type。
见 [Custom Dashboards](https://langfuse.com/docs/metrics/features/custom-dashboards#create-your-first-widget)。

`DashboardWidgetViews`：`TRACES`、`OBSERVATIONS`、`SCORES_NUMERIC`、`SCORES_CATEGORICAL`、`SCORES_BOOLEAN`。
`DashboardWidgetChartType`：折线、面积、柱状时间序列、横向/纵向柱状图、饼图、数字、直方图、透视表。

Home 本身就是 Dashboard。
默认 id 是 `langfuse-home-dashboard`。
路径：`packages/shared/src/domain/home-dashboard.ts`。
Worker 启动时 `upsertLangfuseDashboards.ts` 把它写入 Postgres。
项目可用任意 Dashboard 作为 Home。

Langfuse 管理的 Dashboard 第一次被编辑时，会复制到当前项目再改副本。
原件保持只读。

Widget 可以自带 `environment` 过滤。
它只替换 Dashboard 选择器里的 `environment`，其它过滤仍跟 Dashboard。

程序化管理走 `/api/public/unstable`。
官方标注 unstable，契约仍在定稿。

Blob storage、PostHog、Mixpanel 通过项目设置里的 export source 读数。
v4 默认源是 Enriched observations。
Widget 菜单可以 Download data as CSV。
这是当前查询结果，不是一份新的持久 schema。

## 缺测怎样出现

本次检查的一手公开面未提供每 row 的 `missing` / `partial` / `unsupported` 状态机。
也没有与固定分母对等的 Sample 对象。

| 情况 | 公开行为 |
|---|---|
| 未请求的字段组 | 字段缺席，不是 `null` |
| [`TEXT`](https://langfuse.com/docs/evaluation/scores/overview) / `CORRECTION` score | 不能进入 experiments、LLM-as-a-Judge 或 score analytics；类型排除，不是 row 级 unsupported |
| 一个 Trace 没有导出的应用根 | `isRootObservation = true` 匹配不到；需按 `traceId` 自行分组 |
| 图表缺值 | 可表现为空桶或 `NaN`；官方未给穷尽 coverage 契约 |
