# Langfuse：运行写入、同一产品读取与展示

> 观察日期：2026-08-13
>
> 观察对象：Langfuse Cloud 与自托管 OSS v4，以及官方 Python SDK v4、JS/TS SDK v5
>
> 文档性质：外部产品研究与产品建议，不是 NiceEval 目标契约

Langfuse 是一套由用户代码真实运行、SDK 或 OpenTelemetry 写入、同一产品查询并展示的完整平台。
应用在进程内执行业务逻辑；SDK 把 observation 与 score 发给 Langfuse；同一产品再用 Observations API、Metrics API 与 Dashboard 读取。
它不是外接 SQL 后再画图的 BI 工具。

## 研究判断

Langfuse 的公共作者面是「固定 observation 外壳 + 名字和值」。
它不是版本化 RecordAttachment family。

写入时不声明图表。
图表、Dashboard 与 Metrics 查询发生在读取侧。

Trace 与 observation 在入库后不可更新。
Score 可以后补，也可按 `id`、`name` 与日期粒度替换旧值。

普通应用作者只看到 instrumentation 与可选 score。
分析作者与报告作者共用同一套查询引擎，但报告作者主要在 UI 里组合 widget。

## 观察边界

官方文档站是滚动文档，不能固定到单一 HTML 修订号。
本页事实取自 2026-08-13 当日公开文档、官方 API 参考、正式 migration 文档与官方 GitHub 源码。

| 面 | 观察到的版本边界 |
|---|---|
| 文档站 | [langfuse.com/docs](https://langfuse.com/docs) 滚动页；部分页标注 Last edited Jul 23, 2026 |
| Python SDK | 官方文档以 Python SDK v4 为当前面；[langfuse-python `main` 的 `pyproject.toml`](https://github.com/langfuse/langfuse-python/blob/main/pyproject.toml) 写 `version = "4.14.4"` |
| JS/TS SDK | 官方文档以 JS/TS SDK v5 为当前面；实时 v2 读取要求 `@langfuse` ≥ `5.4.0` |
| 服务端 | Cloud 持续部署服务端版本；自托管 OSS v4 为 GA，v3 安全补丁到 2027-01 |
| 数据库 schema | [语义化版本范围](https://langfuse.com/self-hosting/upgrade/versioning#scope-of-semantic-versioning) 把 database schemas 列为内部实现细节，不进 major bump |

产品没有公开某能力时，正文只写「本次检查的一手公开面未提供」，不推断内部实现。

## 一手材料

- [Core Concepts](https://langfuse.com/docs/observability/data-model)
- [Langfuse SDKs](https://langfuse.com/docs/observability/sdk/overview)
- [Instrumentation](https://langfuse.com/docs/observability/sdk/instrumentation)
- [Observation Types](https://langfuse.com/docs/observability/features/observation-types)
- [Token & Cost Tracking](https://langfuse.com/docs/observability/features/token-and-cost-tracking)
- [Metadata](https://langfuse.com/docs/observability/features/metadata)
- [Tags](https://langfuse.com/docs/observability/features/tags)
- [Multi-Modality and Attachments](https://langfuse.com/docs/observability/features/multi-modality)
- [Scores overview](https://langfuse.com/docs/evaluation/scores/overview)
- [Scores Data Model](https://langfuse.com/docs/evaluation/scores/data-model)
- [Scores via API/SDK](https://langfuse.com/docs/evaluation/evaluation-methods/scores-via-sdk)
- [Score Configs FAQ](https://langfuse.com/faq/all/manage-score-configs)
- [Experiments via SDK](https://langfuse.com/docs/evaluation/experiments/experiments-via-sdk)
- [Experiments Data Model](https://langfuse.com/docs/evaluation/experiments/data-model)
- [Query via SDKs](https://langfuse.com/docs/api-and-data-platform/features/query-via-sdk)
- [Observations API](https://langfuse.com/docs/api-and-data-platform/features/observations-api)
- [Metrics API](https://langfuse.com/docs/metrics/features/metrics-api)
- [Custom Dashboards](https://langfuse.com/docs/metrics/features/custom-dashboards)
- [OpenTelemetry](https://langfuse.com/integrations/native/opentelemetry)
- [Tracing data updates](https://langfuse.com/faq/all/tracing-data-updates)
- [Langfuse v4](https://langfuse.com/docs/v4)
- [Upgrade to v4](https://langfuse.com/faq/all/upgrade-to-langfuse-v4)
- [Migrate v3 to v4](https://langfuse.com/self-hosting/upgrade/upgrade-guides/upgrade-v3-to-v4)
- [Deprecated API migration](https://langfuse.com/faq/all/deprecated-api-migration)
- [Python v3 → v4](https://langfuse.com/docs/observability/sdk/upgrade-path/python-v3-to-v4)
- [Versions & Compatibility](https://langfuse.com/self-hosting/upgrade/versioning)
- [Background Migrations](https://langfuse.com/self-hosting/upgrade/background-migrations)
- [langfuse-python](https://github.com/langfuse/langfuse-python)
- [langfuse 服务端仓库](https://github.com/langfuse/langfuse)
- [Python API 参考](https://python.reference.langfuse.com)
- [JS/TS API 参考](https://js.reference.langfuse.com)
- [Public API 参考](https://api.reference.langfuse.com)

## 产品事实：它怎样构成完整路径

用户代码在自己的进程里运行。
SDK 或 OTLP exporter 把 span 转成 observation，并异步批量发送。

同一产品随后提供三件事：

1. 行级读取：`GET /api/public/v2/observations`
2. 聚合读取：`GET /api/public/v2/metrics`
3. UI 消费：Observations 表、Custom Dashboards、Experiments 比较

Experiment runner 也在用户进程里执行 task 函数。
它自动 tracing，并把 evaluator 结果写成 score。

### 数据模型

Langfuse v4 把一次请求拆成一张 observations 表。
`trace` 是共享同一 `trace_id` 的全部行。
`session` 是可选的多 trace 分组。

[Core Concepts](https://langfuse.com/docs/observability/data-model) 写明：trace 级属性复制到每一行。
公开示例表如下：

| Observation-level data | Trace-level data · on every row |
|---|---|
| id, type, name, latency | trace_id, trace_name, user_id, session_id |

Observation 类型是封闭枚举：`event`、`span`、`generation`、`agent`、`tool`、`chain`、`retriever`、`evaluator`、`embedding`、`guardrail`。
见 [Observation Types](https://langfuse.com/docs/observability/features/observation-types)。

Score 是独立对象。
它恰好引用 Trace、Observation、Session 或 DatasetRun 之一。
见 [Scores Data Model](https://langfuse.com/docs/evaluation/scores/data-model)。

## 问题 1：一次 Run、Trace 怎样开始、封口并形成稳定身份

**产品事实。** Langfuse 没有名为 Run 的公共写入对象。
运行时身份是 `trace_id` 加 observation `id`。
Experiment 另有 `DatasetRun` / experiment 身份。

开始与封口有三条官方路径。

Context manager 开始一段 observation，退出时自动结束：

```python
from langfuse import get_client

langfuse = get_client()

with langfuse.start_as_current_observation(as_type="span", name="process-request") as span:
    span.update(output="Processing complete")

    with langfuse.start_as_current_observation(as_type="generation", name="llm-response", model="gpt-3.5-turbo") as generation:
        generation.update(output="Generated response")

langfuse.flush()
```

一手材料：[SDK overview](https://langfuse.com/docs/observability/sdk/overview) 与 [langfuse-python `__init__.py`](https://github.com/langfuse/langfuse-python/blob/main/langfuse/__init__.py)。

手动 observation 必须显式 `.end()`。
不调用 `.end()` 会得到不完整或缺失的 observation。
见 [Instrumentation](https://langfuse.com/docs/observability/sdk/instrumentation#manual-observations)。

短生命周期进程必须在退出前 `flush()`。
否则缓冲区里的 trace 会丢失。
见 [Background Processing](https://langfuse.com/docs/observability/data-model#background-processing)。

Python SDK 把 OTel 整数 `trace_id` 格式化成 32 位小写十六进制。
见 [`Langfuse._format_otel_trace_id`](https://github.com/langfuse/langfuse-python/blob/main/langfuse/_client/client.py)。

入库后的 trace 与 observation 不可更新。
用同一 `id` 再发送会制造重复行，而不是替换。
见 [Tracing data updates](https://langfuse.com/faq/all/tracing-data-updates)。

Experiment 身份是另一条链：

```text
Dataset → DatasetItem → DatasetRun → DatasetRunItem(traceId, optional observationId)
```

`dataset.run_experiment(name=..., task=...)` 会在 Langfuse 数据集上自动创建 dataset run。
本地数组只产生 traces 与 scores，不产生 dataset run。
见 [Experiments Data Model](https://langfuse.com/docs/evaluation/experiments/data-model)。

**研究判断。** 对 NiceEval 来说，Langfuse 的「一次请求」更接近一次 Attempt 内的执行树，而不是一份已发布 Run。
`flush()` 是进程退出前的发送屏障，不是 Record 的 seal。

## 问题 2：官方 Timing、Usage、Score、Evidence、Artifact 怎样写入

### Timing

**产品事实。** Timing 来自 observation 的起止时间，不是单独的 Timing 写入 API。
`observe()` 与 context manager 自动捕获 timings。
v2 Observations API 的 `metrics` 字段组返回 `latency` 与 `timeToFirstToken`。
见 [Instrumentation](https://langfuse.com/docs/observability/sdk/instrumentation) 与 [Observations API](https://langfuse.com/docs/api-and-data-platform/features/observations-api#available-field-groups)。

### Usage

Usage 与 cost 只写在 `generation` 与 `embedding` 上。
官方字段是 `usage_details` 与 `cost_details`。
键是任意字符串；`input` / `output` 是最高层约定。

```python
generation.update(
    output=response.content[0].text,
    usage_details={
        "input": response.usage.input_tokens,
        "output": response.usage.output_tokens,
        "cache_read_input_tokens": response.usage.cache_read_input_tokens
    },
    cost_details={
        "input": 1,
        "cache_read_input_tokens": 0.5,
        "output": 1,
    }
)
```

一手材料：[Token & Cost Tracking](https://langfuse.com/docs/observability/features/token-and-cost-tracking#ingest)。

每个 key 必须是互斥 bucket。
`total` 不是 bucket；未写入时由各 bucket 求和。
直接写入的 flat `usage_details` 按原文保存，产品不做归一化。
见同一页的 [Usage types are mutually exclusive buckets](https://langfuse.com/docs/observability/features/token-and-cost-tracking#usage-details-contract)。

未写入时，产品可按 model 定义推断 usage 与 cost。
已摄入值优先于推断值。

### Score

Score 用独立 API 写入，可后补到已存在的 trace。

```python
from langfuse import get_client
langfuse = get_client()

langfuse.create_score(
    name="correctness",
    value=0.9,
    trace_id="trace_id_here",
    observation_id="observation_id_here",
    data_type="NUMERIC",
    comment="Factually correct",
)

with langfuse.start_as_current_observation(as_type="span", name="my-operation") as span:
    span.score(
        name="correctness",
        value=0.9,
        data_type="NUMERIC",
        comment="Factually correct"
    )
    span.score_trace(
        name="overall_quality",
        value=0.95,
        data_type="NUMERIC"
    )
```

一手材料：[Scores via API/SDK](https://langfuse.com/docs/evaluation/evaluation-methods/scores-via-sdk)。
SDK 签名见 [`Langfuse.create_score`](https://github.com/langfuse/langfuse-python/blob/main/langfuse/_client/client.py)。

REST 面是 `POST /api/public/scores`。
类型为 `NUMERIC`、`CATEGORICAL`、`BOOLEAN`、`TEXT`。
`source` 由产品写成 `API`、`EVAL` 或 `ANNOTATION`。

Experiment evaluator 返回 `Evaluation(name=..., value=..., comment=...)`，runner 再把它写成 score。
见 [Experiments via SDK](https://langfuse.com/docs/evaluation/experiments/experiments-via-sdk#evaluators)。

### Evidence

本次检查的一手公开面未提供名为 Evidence 的对象。
最接近的公开字段是 score 的 `comment`，以及 `TEXT` score 的自由文本。
`comment` 用来放 LLM judge 理由、评审备注或内部说明。
见 [Score Comments](https://langfuse.com/docs/evaluation/scores/overview#score-comments)。

`TEXT` score 不能进入 experiments、LLM-as-a-Judge 或 score analytics。

### Artifact

媒体与附件走 object storage，不进 observation JSON 本体。

```python
from langfuse import get_client
from langfuse.media import LangfuseMedia

with open("static/bitcoin.pdf", "rb") as pdf_file:
    pdf_bytes = pdf_file.read()

pdf_media = LangfuseMedia(content_bytes=pdf_bytes, content_type="application/pdf")

langfuse = get_client()
with langfuse.start_as_current_observation(as_type="span", name="analyze-document") as span:
    span.update(
        input={"document": pdf_media},
        metadata={"file_size": len(pdf_bytes)}
    )
```

一手材料：[Custom attachments](https://langfuse.com/docs/observability/features/multi-modality#custom-attachments)。

替换后的引用 token 是：

```text
@@@langfuseMedia:type={MIME_TYPE}|id={LANGFUSE_MEDIA_ID}|source={SOURCE_TYPE}@@@
```

去重键是 project、content type 与 content SHA256。
API 路径是 `POST /api/public/media`，再用 presigned URL 上传。

**研究判断。** Timing 是 span 生命周期的派生量。
Usage 是 generation 上的名字到数值映射。
Score 是后补评价对象。
媒体是内容寻址引用，不是版本化 Attachment family。

## 问题 3：用户扩展的是名字和值、固定 envelope、任意属性，还是版本化 schema

**产品事实。** 公开扩展主要是「固定外壳上的名字和值」。

| 扩展点 | 用户实际扩展什么 | 约束 |
|---|---|---|
| observation `as_type` | 从封闭枚举选一种类型 | 不能注册新类型 |
| `metadata` | 任意键值；传播面要求字母数字键、字符串值且 ≤200 字符 | 超长值丢弃并警告 |
| `tags` | 字符串标签，每条 ≤200 字符 | 入库后不可改 |
| `usage_details` / `cost_details` | 任意字符串键与数值 | 仅 generation / embedding；键必须互斥 |
| Score `name` + `value` + `dataType` | 名字和值 | 可选 `configId` |
| `ScoreConfig` | 名字、类型、数值范围或类别 | 可选；人评必须有 |
| `LangfuseMedia` | 字节与 MIME type | 固定 token envelope |
| 未映射 OTel 属性 | 落入 `metadata.attributes` | 默认不可直接过滤 |

传播 metadata 的官方调用是：

```python
from langfuse import observe, propagate_attributes

@observe()
def process_data():
    with propagate_attributes(
        metadata={"source": "api", "region": "us-east-1", "user_tier": "premium"}
    ):
        result = perform_processing()
    return result
```

一手材料：[Metadata](https://langfuse.com/docs/observability/features/metadata)。

ScoreConfig 用 `configId` 绑定一次写入校验：

```python
langfuse.create_score(
    trace_id="trace_id_here",
    name="accuracy",
    value=0.9,
    config_id="78545-6565-3453654-43543",
    data_type="NUMERIC"
)
```

一手材料：[Enforcing a Score Config](https://langfuse.com/docs/evaluation/evaluation-methods/scores-via-sdk#enforcing-a-score-config)。

[Scores Data Model](https://langfuse.com/docs/evaluation/scores/data-model#score-config) 写 Configs are immutable but can be archived。
[Score Configs FAQ](https://langfuse.com/faq/all/manage-score-configs#update-a-score-config) 又写 Score configs may be updated at any time，且既有 score 不受影响。
两处公开面不一致；本次不推断哪一侧对应内部存储。

本次检查的一手公开面未提供用户自定义、带相邻 migration 的版本化 payload family。
Dataset、ScoreConfig 与 Dashboard JSON 各自有对象 schema，但它们不是用户事实的版本族。

**研究判断。** Langfuse 扩展的是名字和值，外加一层固定 observation / score / media envelope。
它不是 NiceEval 那种 sealed domain value → 版本化 Attachment → projector。

## 问题 4：写入 API 是否要求用户预先决定图表

**产品事实。** 写入 API 只保存中立事实。
`start_as_current_observation`、`usage_details`、`create_score` 与 `LangfuseMedia` 都不接受图表、widget 或 Dashboard 参数。

图表在读取侧创建。
作者在 Dashboards → Widgets 里选 data source、metrics、dimensions、filters 与 chart type。
见 [Custom Dashboards](https://langfuse.com/docs/metrics/features/custom-dashboards#create-your-first-widget)。

**研究判断。** 写入与展示分离成立。
分离发生在产品内部：同一平台先存 observation，再让 UI 或 Metrics API 消费。

## 问题 5：读取与分析怎样选择范围、固定分母、分组、聚合，并处理 missing

**产品事实。** 官方读取分成行级与聚合两级。

行级查询：

```python
observations = langfuse.api.observations.get_many(
    trace_id="abcdef1234",
    type="GENERATION",
    limit=100,
    fields="core,basic,usage"
)
```

一手材料：[Query via SDKs](https://langfuse.com/docs/api-and-data-platform/features/query-via-sdk#observations)。

未请求的字段组在响应中缺席，不是 `null`。
`input` / `output` 以原始字符串返回，调用方自己把字符串解码成目标结构。
分页用 cursor，结果按 `startTime` 降序。
见 [Observations API v2](https://langfuse.com/docs/api-and-data-platform/features/observations-api#v2)。

聚合查询：

```python
query = """
{
  "view": "observations",
  "metrics": [{"measure": "totalCost", "aggregation": "sum"}],
  "dimensions": [{"field": "providedModelName"}],
  "filters": [],
  "fromTimestamp": "2025-05-01T00:00:00Z",
  "toTimestamp": "2025-05-13T00:00:00Z"
}
"""
metrics = langfuse.api.metrics.get(query = query)
```

一手材料：[Query via SDKs](https://langfuse.com/docs/api-and-data-platform/features/query-via-sdk#metrics)。

v2 Metrics 的 view 是 `observations`、`scores-numeric`、`scores-categorical`、`scores-boolean`。
`traces` view 已删除。
要数 trace，需过滤 `isRootObservation = true`。

```json
[
  {
    "column": "isRootObservation",
    "operator": "=",
    "value": true,
    "type": "boolean"
  }
]
```

一手材料：[Semantic-root filtering](https://langfuse.com/docs/metrics/features/metrics-api#semantic-root-filtering-and-grouping)。

公开限制：

| 情况 | 公开行为 |
|---|---|
| 高基数维度 `id`、`traceId`、`userId`、`sessionId` | 可过滤，不可分组 |
| 未请求的字段组 | 字段缺席，不是 null |
| 一个 trace 没有导出的应用根 | `isRootObservation = true` 匹配不到；需按 `traceId` 自行分组 |
| `TEXT` score | 不能进入 experiments、LLM-as-a-Judge 或 score analytics |
| Session | 没有专用读取端点；按 `sessionId` 拉 observation 后在客户端分组 |
| 默认行数 | Metrics v2 默认 100，最大 1000 |

本次检查的一手公开面未提供与 NiceEval 对等的 `unsupported` 状态机。
也未提供「分母上每个 row 的穷尽 coverage」对象。
`TEXT` 不能聚合，是类型排除，不是 row 级 unsupported。

**研究判断。** Metrics API 的 view / dimension / measure / filter 接近 Analysis 的选择与 rollup。
它不提供 Sample 分母、每 row 状态或 issues。

## 问题 6：图表、Dashboard 与 Report 怎样消费分析结果

**产品事实。** 报告作者主要使用 UI，其次使用同一套 Metrics API。

Widget 配置包括：

- Data Source：traces、observations 或 evaluation scores
- Metrics：count、latency、cost、scores
- Dimensions：user、model、time、trace name
- Filters 与 Chart Type

Chart Type 包括折线图、柱状图、时间序列与饼图。
见 [Custom Dashboards](https://langfuse.com/docs/metrics/features/custom-dashboards)。

Widget 与 Dashboard 使用版本化 JSON envelope：

```text
{"$langfuseWidget": true, "version": 1, ...}
{"$langfuseDashboard": true, "version": 1, ...}
```

Dashboard 文件内联全部 widget 配置，不携带数据库 ID。
可跨项目与实例导入。
见 [Import and export as JSON](https://langfuse.com/docs/metrics/features/custom-dashboards#import-and-export-as-json)。

程序化管理走 `/api/public/unstable` 的 dashboards 与 widgets 端点，以及 CLI 与 MCP。
官方标注这些端点 unstable，契约仍在定稿。

Home 页本身就是一个 dashboard。
项目可把任意 dashboard 设为 Home。

**研究判断。** Langfuse 的报告作者面是「查询声明 + UI 布局」，不是 typed `ReportData` 组件树。
代码与 UI 共用 Metrics 查询形状，但不共用一套封闭语义组件。

## 问题 7：历史数据怎样面对 SDK、schema 与产品升级

**产品事实。** 升级分成四条独立轨道。

### 服务端与数据库

自托管 v3 → v4 分三步：

1. 先升级 ClickHouse 到 ≥ 25.12，此时仍跑 Langfuse v3
2. 升级服务端到 v4；schema migrations 启动时自动应用
3. 再切到新数据模型：升级 SDK、迁移 API 消费者、回填或等观测保留时段结束，最后切到 `events_only`

见 [Migrate v3 to v4](https://langfuse.com/self-hosting/upgrade/upgrade-guides/upgrade-v3-to-v4)。

v4 引入两张 ClickHouse 表：

- `events_full`：不可变、完整保真的事件表
- `events_core`：截断 input/output/metadata 的查询投影，由 materialized view 填充

历史 traces 转成虚拟 root span，类型 `SPAN`，span ID 为 `t-<trace_id>`。
PostgreSQL 中的 projects、users、prompts、datasets、scores configuration 不受影响。

写模式 `legacy` 与 `dual` 是迁移工具，不是长期运行模式。
切到 `events_only` 后，旧 ingestion 与旧读取端点返回 400 或 404。

历史数据有两种官方选择：

- automated backfill：后台改写到新表，需约 3 倍 ClickHouse 磁盘
- retention-based rollover：保持 dual write，直到观测保留时段结束

Background migrations 在 worker 启动时执行。
可用 `LANGFUSE_ENABLE_BACKGROUND_MIGRATIONS=false` 关闭，但官方不建议。
见 [Background Migrations](https://langfuse.com/self-hosting/upgrade/background-migrations)。

[语义化版本范围](https://langfuse.com/self-hosting/upgrade/versioning#scope-of-semantic-versioning) 写明：database schemas 与 Frontend APIs 不构成 major bump。

### SDK 与 Public API

Python v4 / JS v5 把高吞吐读取设为默认：

| 旧名 | 新默认 |
|---|---|
| `api.observations_v_2` | `api.observations` |
| `api.metrics_v_2` | `api.metrics` |
| `api.scores` v2 | `api.scores_v3` |

旧读取在 v4 上 404。
映射见 [Deprecated API migration](https://langfuse.com/faq/all/deprecated-api-migration)。

旧 SDK 或未带 `x-langfuse-ingestion-version: 4` 的 OTel 数据，在 v2 读取上最多延迟 10 分钟。
Python ≥ 4.7.0、JS ≥ 5.4.0 才实时。

### 已入库事实

Trace 与 observation 不能靠重发同一 `id` 改写。
Score 仅在 `id`、`name` 与 `toDate(timestamp)` 三者同时匹配时替换旧值。
部分字段合并已 deprecated。
见 [Updating scores](https://langfuse.com/faq/all/tracing-data-updates#updating-scores)。

LLM-as-a-Judge 必须在 cutover 前从 trace-level 迁到 observation-level。
Export 必须从 legacy traces/observations 源切到 enriched observations。

**研究判断。** Langfuse 的 migration 由平台声明并回填。
用户不声明 family 级相邻 migration，也不签发一次性 authorization。

## 问题 8：四类作者分别需要理解多少层

**产品事实**按公开入口归纳：

| 角色 | 必须理解 | 可以不理解 |
|---|---|---|
| 普通应用作者 | `observe` / `start_as_current_observation`、`propagate_attributes`、`flush`、可选 `score` | ClickHouse 表、写模式、Dashboard JSON、migration plan |
| 扩展作者 | 封闭 observation 类型、metadata/tag 约束、`usage_details` 键、`LangfuseMedia`、可选 `ScoreConfig`、OTel `langfuse.*` 前缀 | 版本化 payload family、host installation trust |
| 分析作者 | Observations v2 字段组、Metrics view/dimension/measure/filter、`isRootObservation`、cursor、缺席字段 | Widget 布局、ClickHouse DDL |
| 报告作者 | Widget data source、chart type、Dashboard JSON envelope、同一套 Metrics 查询 | Record I/O、producer lease、migration authorization |

普通应用作者看到 1 层：instrumentation。
扩展作者看到 2 层：固定外壳 + 名字和值。
分析作者看到 2 层：行级读取 + 聚合查询。
报告作者看到 2 层：查询声明 + UI 或 JSON 布局。

没有人需要理解「sealed value → adapter → canonical command」。
也没有人持有显式 migration receipt。

**研究判断。** 分层是按产品入口自然分开的，不是按权限 facet 切开的。
分析与报告共用查询引擎，所以报告作者仍会碰到 view 与 dimension，而不是只拿到已经计算并返回的 typed fields。

## 四个 NiceEval 场景

### 官方 OTel Timing

**产品事实。** Langfuse 原生建在 OpenTelemetry 上。
官方写入端点是 `POST /api/public/otel/v1/traces`。
Python / JS 官方建议用 Langfuse SDK，而不是手写 OTel API。

```bash
OTEL_EXPORTER_OTLP_ENDPOINT="https://cloud.langfuse.com/api/public/otel"
OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic ${AUTH_STRING},x-langfuse-ingestion-version=4"
```

一手材料：[OpenTelemetry endpoint](https://langfuse.com/integrations/native/opentelemetry#opentelemetry-endpoint)。

Timing 由 span 起止时间派生。
`langfuse.observation.usage_details` 与 `gen_ai.usage.*` 映射到 usage。
未映射属性进入 `metadata.attributes`。
见 [Attribute Mapping](https://langfuse.com/integrations/native/opentelemetry#property-mapping)。

要按 `userId`、`sessionId`、`metadata` 过滤或聚合，这些属性必须出现在每个 span 上，不能只写在 root。

**NiceEval 建议。** 官方 Timing 应对齐「SDK 生命周期自动封口，作者不写 schema」。
不要让普通 Eval 作者看见 OTel 属性前缀或 ingestion version header。

### 用户 GPU Energy

**产品事实。** 本次检查的一手公开面未提供 GPU Energy、焦耳或 NVML 类型。
OpenLIT 对照表里有 NVIDIA / AMD GPU 行，但那是第三方 instrumentation 目录，不是 Langfuse 一等事实类型。

最接近的写入口是：

1. `usage_details` 增加自定义键，但官方只把它挂在 generation / embedding 上
2. `metadata` 写键值，传播面还受 200 字符与字母数字键限制
3. 写成 `NUMERIC` score，名字自定

三种路径都不会自动变成 Metrics 里的一等 measure。
本次检查的一手公开面未提供「自定义 usage 键如何进入 Dashboard measure 列表」的完整契约。

**NiceEval 建议。** 不要学「把焦耳写入 token usage map」。
GPU Energy 应走领域 Plugin → sealed value → RecordAttachment adapter → 领域 Analysis field。

### Assertion 与 Evidence

**产品事实。** Langfuse 没有 Assertion 对象，也没有 Evidence 对象。
最接近的组合是：

```python
from langfuse import Evaluation

def accuracy_evaluator(*, input, output, expected_output, metadata, **kwargs):
    if expected_output and expected_output.lower() in output.lower():
        return Evaluation(name="accuracy", value=1.0, comment="Correct answer found")
    return Evaluation(name="accuracy", value=0.0, comment="Incorrect answer")
```

一手材料：[Experiments via SDK](https://langfuse.com/docs/evaluation/experiments/experiments-via-sdk#evaluators)。

`comment` 是可选理由。
媒体可作为 input/output/metadata 中的 artifact。
人评必须先有 ScoreConfig。

Score 默认可同名多条。
要用稳定 `id` + `name` + `timestamp` 才能替换旧值。
它不是不可变 Claim。

**NiceEval 建议。** 可以吸收「评价与执行树分开写」。
不要吸收可替换旧值的 score，也不要把 `comment` 当成完整 evidence basis。

### 旧数据升级后重新分析与报告

**产品事实。** 旧项目要先改 ingestion，再改读取，最后才切写模式。

1. SDK 升到 Python ≥ 4.7.0 或 JS ≥ 5.4.0，或给 OTel 加上 `x-langfuse-ingestion-version: 4`
2. 读取从 `/traces`、`/observations`、`/metrics` 迁到 v2
3. Evaluator 从 trace-level 迁到 observation-level
4. Export 切到 enriched observations
5. 自托管选择 backfill 或 retention rollover，再切 `events_only`

切过后，Dashboard 与 Metrics 读 `events_core` / `events_full`。
旧 trace 以虚拟 root span 出现。
旧 API 返回 404。

重新分析不是「同一份不可变 Record 上换 projector」。
它是「平台回填宽表后，用新查询面再聚合」。

**NiceEval 建议。** 可以吸收「读取面与写入面分开升级，并设置双写过渡期」。
不要吸收「平台静默改写用户事实，且 schema 不进公开 semver」。

## 与 NiceEval 的概念映射

| 问题 | Langfuse | NiceEval | 不能直接类比之处 |
|---|---|---|---|
| 一次执行 | observation 树，按 `trace_id` 分组 | Attempt / Run | Langfuse trace 不是已发布不可变 Run |
| 官方 Timing | span 起止时间与 `latency` | OTel Timing Attachment | Langfuse Timing 没有独立 schema family |
| 自定义用量 | `usage_details` 或 metadata | 领域 Plugin + adapter | Langfuse 没有版本化自定义事实 |
| 评价 | Score + 可选 ScoreConfig | AssertionResult / Claim | Score 可后补、可替换旧值 |
| 证据 | `comment`、`TEXT` score、media | Evidence / Attachment | 没有 evaluator 版本与 evidence basis |
| 分析 | Metrics API view/dimension/measure | Analysis Dimension / Measure | 没有 Sample 分母与每 row 穷尽状态 |
| 报告 | Widget + Dashboard JSON | `ReportData` + 语义组件 | 报告作者仍接触查询，而不是只 import fields |
| 升级 | 平台 backfill 与 API 退役 | 显式 plan、authorization、receipt | Langfuse 用户不声明相邻 migration |

## 产品事实、研究判断、NiceEval 建议

### 产品事实

- 用户代码运行；SDK 或 OTLP 写入；同一产品读取与展示。
- 公共写入对象是 observation、score、media 与 dataset/experiment。
- 入库后的 observation 不可更新；score 可后补或按三元组替换旧值。
- 扩展主要是名字和值，外加封闭类型枚举与可选 ScoreConfig。
- 写入不绑定图表；Dashboard 与 Metrics 在读取侧消费。
- v4 把历史数据迁进宽表，或等待观测保留时段结束。

### 研究判断

- Langfuse 证明「运行写入与同产品分析展示」可以是一条完整路径。
- 它用宽表复制与查询性能换来了作者面简单，也放弃了用户事实的版本族。
- 分析与报告没有从查询引擎里再分出一层 typed fields。
- ScoreConfig 的「不可变」与「可更新」在公开文档中并存，说明配置身份并不稳定。

### NiceEval 建议

- 保持写入中立事实、读取再分析。
- 普通作者只碰领域 API。
- 自定义事实必须有 owner、schema identity 与显式 migration。
- 分析要固定分母，并保留每 row 状态。
- 报告作者只组合已发布 fields，不写 Metrics JSON。

## 值得吸收

- 同一产品走完「用户代码运行 → SDK 写入 → 查询 → Dashboard」。
- 写入 API 不要求作者先决定图表。
- 评价对象与执行树分开，允许后补而不改写 observation。
- 媒体用内容哈希去重，并用稳定 token 引用。
- 读取分成行级与聚合两级；聚合用 view、dimension、measure、filter。
- `isRootObservation` 明确区分物理父节点与逻辑分母。
- 缺席字段就是缺席，不用 `null` 假装存在。
- 短生命周期进程必须有显式 `flush`。
- 服务端升级、SDK 升级与历史回填可以分步，并提供双写过渡期。
- 普通应用作者不必看见存储表或 migration。

## 不应复制

- 把用户扩展做成任意 metadata / usage 键，而不是版本化 schema。
- 让 score 可以按 id 替换旧值，却没有 evaluator 版本与 evidence basis。
- 把数据库 schema 排除在公开 semver 之外，同时对用户数据做平台回填。
- 用封闭 observation 类型枚举代替领域 adapter。
- 让报告作者直接写 Metrics 查询或 unstable Dashboard API。
- 用 `TEXT` score 承载不能聚合的证据，却没有 unsupported / coverage 状态。
- 把 GPU 一类领域量写入 token usage map。
- 用「重发同一 id」处理更正；v4 会生成重复行并污染 `sum(totalCost)`。

## 尚缺证据

- 自定义 `usage_details` 键如何成为 Dashboard 的一等 measure。
- metadata 作为 Metrics dimension 时的类型、基数与 missing 策略。
- ScoreConfig 更新后，旧 score 的 `configId` 指向哪一份 schema。
- `events_full` / `events_core` 的完整列清单；公开文档只给了表职责。
- 平台 backfill 失败时，哪些行保留、哪些行重试、有没有不可伪造 receipt。
- Experiment 重复样本；官方写明当前假设每题一次，重复支持见 [#5855](https://github.com/langfuse/langfuse/issues/5855)。
- GPU Energy 或其它非 LLM 资源量的官方写入与聚合路径。
- Dashboard JSON `version: 1` 之后如何升版，以及旧 widget 是否自动迁移。
