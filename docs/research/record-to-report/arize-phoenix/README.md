# Arize Phoenix：Trace、Dataset、Experiment 与 Annotation

> 观察日期：2026-08-13
>
> 观察对象：Arize Phoenix 开源平台，以及它的官方 Client、OTel 与 Evals SDK
>
> 文档性质：外部产品研究与产品建议，不是 NiceEval 目标契约

本页研究 Phoenix 的完整产品模型。Evaluator 自身如何成为可观察 Trace 的重点判断另见 [Evaluator 可观察性](evaluator-observability.md)。

Phoenix 不是外接 SQL 后再画图的 BI 工具。
用户代码真实执行应用或实验任务。
OpenTelemetry 与 OpenInference 把一次运行写成 Trace 与 Span。
同一套 Phoenix 服务再查询、打分、比较并展示这些事实。

## 研究判断

产品事实：Phoenix 把 tracing、Dataset、Experiment、Annotation 与预置 Metrics Dashboard 收在同一产品里。
写入走 OTLP 与 REST。读取走 Client、Filter Expression 与 UI。

研究判断：它对 NiceEval 最有价值的不是图表清单。
它证明了一条完整回路：用户函数实际跑完，SDK 按约定写入，同一产品再按名字读取分数与轨迹。

研究判断：它的扩展面是「约定名字 + 固定信封 + 任意属性」，不是版本化 schema。
普通应用作者几乎只看见 OTel 与领域函数。
分析与报告作者没有独立的 Analysis field 或 Report 声明层。

NiceEval 建议：吸收「同一产品读写」和「Experiment 固定 Dataset 版本」。
不要把任意属性袋或预置 Dashboard 当成 RecordAttachment 与 Report 的模板。

## 一手材料与版本边界

官方文档站按 `/llms.txt` 滚动更新。
本文把观察日能打开的页面当作文档事实，不把它当成某个 tag 的冻结副本。

| 对象 | 观察版本或边界 | 固定方式 | 观察事实 |
|---|---|---|---|
| Phoenix 服务端 | `arize-phoenix` 20.1.0 | GitHub Release `arize-phoenix-v20.1.0`，提交 `ae40421`，2026-08-12 | [Release](https://github.com/Arize-ai/phoenix/releases/tag/arize-phoenix-v20.1.0)；[PyPI](https://pypi.org/project/arize-phoenix/) |
| Python Client | `arize-phoenix-client` 3.1.0 | PyPI，2026-08-11 | [PyPI](https://pypi.org/project/arize-phoenix-client/) |
| TypeScript Client | `@arizeai/phoenix-client` 7.5.0 | npm 观察日 latest | [npm](https://www.npmjs.com/package/@arizeai/phoenix-client) |
| 官方文档 | 滚动站点 | 观察日打开的 `arize.com/docs/phoenix` | [文档首页](https://arize.com/docs/phoenix)；[llms.txt](https://arize.com/docs/phoenix/llms.txt) |
| OpenInference 约定 | 滚动规范 | 观察日打开的官方 spec 与 semconv 源码 | [Semantic Conventions](https://arize-ai.github.io/openinference/spec/semantic_conventions.html) |
| 服务端 migration | `MIGRATION.md` on `main` | 观察日 raw 文件 | [MIGRATION.md](https://raw.githubusercontent.com/Arize-ai/phoenix/main/MIGRATION.md) |
| Experiment 源码 | 仓库 `main` | 观察日 raw 文件 | [experiments/\_\_init\_\_.py](https://raw.githubusercontent.com/Arize-ai/phoenix/main/packages/phoenix-client/src/phoenix/client/resources/experiments/__init__.py) |

先前仓库内的断言研究钉过服务端 19.19.1 与更旧 Client。
本文改用观察日公开 latest。
`MIGRATION.md` 写明 v19.x 升到 v20.0.0 无需操作。

下列代号只在后文表格里复用。每条都是官方文档、官方仓库、官方发布注册表或官方 spec。

| 代号 | 内容 |
|---|---|
| [HOME] | [What is Arize Phoenix](https://arize.com/docs/phoenix) |
| [DS-CONCEPT] | [Concepts: Datasets](https://arize.com/docs/phoenix/datasets-and-experiments/concepts-datasets) |
| [DS-CREATE] | [Creating Datasets](https://arize.com/docs/phoenix/datasets-and-experiments/how-to-datasets/creating-datasets) |
| [EXP-HOWTO] | [How to: Experiments](https://arize.com/docs/phoenix/datasets-and-experiments/how-to-experiments) |
| [EXP-QS-PY] | [Python Experiments Quickstart](https://arize.com/docs/phoenix/get-started/get-started-datasets-and-experiments) |
| [EXP-QS-TS] | [TypeScript Experiments Quickstart](https://arize.com/docs/phoenix/get-started/ts-get-started-datasets-and-experiments) |
| [EXP-EVAL] | [Using Evaluators](https://arize.com/docs/phoenix/datasets-and-experiments/how-to-experiments/using-evaluators) |
| [EXP-REP] | [Repetitions](https://arize.com/docs/phoenix/datasets-and-experiments/how-to-experiments/repetitions) |
| [CLIENT-PY-SRC] | [Python Client 文档源](https://raw.githubusercontent.com/Arize-ai/phoenix/main/packages/phoenix-client/docs/source/index.md) |
| [CLIENT-PY-DOC] | [arize-phoenix-client](https://arize.com/docs/phoenix/sdk-api-reference/python/arize-phoenix-client) |
| [CLIENT-TS-EXP] | [TypeScript Experiments](https://arize.com/docs/phoenix/sdk-api-reference/typescript/packages/phoenix-client/experiments) |
| [CLIENT-TS-DS] | [TypeScript Datasets](https://arize.com/docs/phoenix/sdk-api-reference/typescript/packages/phoenix-client/datasets) |
| [CLIENT-TS-OV] | [TypeScript Client Overview](https://arize.com/docs/phoenix/sdk-api-reference/typescript/packages/phoenix-client/overview) |
| [TRACE-QS] | [Send Traces From Your App](https://arize.com/docs/phoenix/get-started/get-started-tracing) |
| [TRACE-WHAT] | [What are Traces](https://arize.com/docs/phoenix/tracing/concepts-tracing/what-are-traces) |
| [OTEL-SEM] | [OpenInference Semantic Conventions](https://arize.com/docs/phoenix/tracing/concepts-tracing/otel-openinference/semantic-conventions) |
| [OTEL-ATTR] | [Add Attributes, Metadata, Users](https://arize.com/docs/phoenix/tracing/how-to-tracing/add-metadata/customize-spans) |
| [OTEL-INST] | [使用 instrumentation 封装](https://arize.com/docs/phoenix/tracing/how-to-tracing/setup-tracing/instrument) |
| [COST] | [Cost Tracking](https://arize.com/docs/phoenix/tracing/how-to-tracing/cost-tracking) |
| [FILTER] | [Filter Expressions](https://arize.com/docs/phoenix/tracing/how-to-tracing/filter-expressions) |
| [EXPORT] | [Export Data & Query Spans](https://arize.com/docs/phoenix/tracing/how-to-tracing/importing-and-exporting-traces/extract-data-from-spans) |
| [ANN-CONCEPT] | [Annotations](https://arize.com/docs/phoenix/tracing/llm-traces/how-to-annotate-traces) |
| [ANN-UI] | [Annotating in the UI](https://arize.com/docs/phoenix/tracing/how-to-tracing/feedback-and-annotations/annotating-in-the-ui) |
| [ANN-SDK] | [Annotating via the Client](https://arize.com/docs/phoenix/tracing/how-to-tracing/feedback-and-annotations/capture-feedback) |
| [METRICS] | [Metrics Dashboard](https://arize.com/docs/phoenix/tracing/llm-traces/metrics) |
| [REST] | [REST API Overview](https://arize.com/docs/phoenix/sdk-api-reference/rest-api/overview) |
| [MIG] | [MIGRATION.md](https://raw.githubusercontent.com/Arize-ai/phoenix/main/MIGRATION.md) |
| [OI-SPEC] | [OpenInference reserved attributes](https://arize-ai.github.io/openinference/spec/semantic_conventions.html) |
| [OI-SRC] | [openinference semconv 源码](https://raw.githubusercontent.com/Arize-ai/openinference/main/python/openinference-semantic-conventions/src/openinference/semconv/trace/__init__.py) |
| [EXP-SRC] | [Python experiments 源码](https://raw.githubusercontent.com/Arize-ai/phoenix/main/packages/phoenix-client/src/phoenix/client/resources/experiments/__init__.py) |

## 产品真实边界

产品事实：官方首页把工作流写成四段。发送 traces，评分，改 prompt，再用同一组输入跑 Experiment 比较。[HOME]

产品事实：Trace 表示一次应用运行。
Span 是其中一步。Phoenix 经 OTLP 接收这些数据。[HOME] [TRACE-QS]

产品事实：Dataset 是 example 集合。
每个 example 有 `inputs`，可选 `output`，可选 `metadata`。[DS-CONCEPT]

产品事实：Experiment 在同一 Dataset 上重跑用户任务，并收集 evaluator 结果。[EXP-QS-PY]

产品事实：评分持久化成 Annotation。
它可以来自 HUMAN、LLM 或 CODE。[ANN-SDK]

产品事实：预置 Metrics Dashboard 自动索引项目里的 traces。
自定义 alerting 与面向非开发者的 Dashboard，官方指向 Arize AX。[METRICS]

产品事实：`phoenix-evals` 可以脱离 Phoenix 服务端算出 `Score`。
要进入同一产品的查询与 UI，必须再写成 Annotation 或 Experiment evaluation。

本次检查的一手公开面未提供：用户自定义 Dashboard 声明、用户版本化事实 schema、GPU Energy 一类领域事实类型。

## 与 NiceEval 概念的对应

这张表只做对照，不把 Phoenix 词改写成 NiceEval 契约。

| Phoenix 公开对象 | 更接近 NiceEval 的哪一层 | 不能直接类比的地方 |
|---|---|---|
| Trace / Span | 一次运行的遥测，不是 RecordAttachment | 身份是 OTel `trace_id` / `span_id`，不是 sealed Attempt owner |
| Dataset example | 题集行，不是 Record | example 可改，且每次改动产生 Dataset 版本 |
| Task 函数 | 用户代码里的执行体 | 不是持久实体，没有独立 ID |
| Experiment | 一次固定 Dataset 版本的评测运行 | 任务在 Client 进程里执行，服务端存结果 |
| Annotation | 写回的分数信封 | 不是 AssertionResult，也没有 subject snapshot |
| `explanation` | 最接近 Evidence 的公开字段 | 规范把它叫 reason or evidence，不是独立 Evidence 类型 |
| SpanQuery / Filter | Analysis 读取 | 没有 Sample 分母，也没有 Dimension / Measure |
| Metrics Dashboard / Compare 页 | Report 展示 | 作者不声明 `ReportData` |

## Trace、Dataset、Task 与 Experiment 身份

### Trace 与 Span

产品事实：一次应用运行形成一条 Trace。
它由若干 Span 组成。根 Span 表示请求从开始到结束。[TRACE-WHAT]

产品事实：Span 带 OTel `trace_id`、`span_id`、`parent_id`、`start_time`、`end_time` 与 `status`。
属性是任意键值对，键必须是非空字符串。[TRACE-WHAT]

产品事实：最小写入是注册 tracer，然后跑用户代码。
本地默认把 UI 与 OTLP HTTP 放在 `6006`。[TRACE-QS]

```python
from phoenix.otel import register

tracer_provider = register(
    project_name="crewai-tracing-quickstart",
    auto_instrument=True,
)
```

```python
from phoenix.otel import register

tracer_provider = register(protocol="http/protobuf", project_name="your project name")
tracer = tracer_provider.get_tracer(__name__)

with tracer.start_as_current_span(
    "my-span-name",
    openinference_span_kind="chain",
) as span:
    span.set_input("input")
    span.set_output("output")
```

上面两段分别来自 [TRACE-QS] 与 [OTEL-INST]。
封口由 OTel span end 完成。
本次检查的一手公开面未提供「用户必须再调用一个 Phoenix seal API」的要求。

### Dataset

产品事实：Dataset 每次 insert、update、delete 都版本化。
Experiment 可以固定某个 Dataset 版本。[DS-CONCEPT]

产品事实：Phoenix 没有 Dataset 类型枚举。
`inputs` 与 `outputs` 是任意键值对。[DS-CONCEPT]

```python
from phoenix.client import Client

client = Client()
dataset = client.datasets.create_dataset(
    name="customer-support-qa",
    dataset_description="Q&A dataset for customer support evaluation",
    inputs=[
        {"question": "How do I reset my password?"},
        {"question": "What's your return policy?"},
        {"question": "How do I track my order?"},
    ],
    outputs=[
        {
            "answer": "You can reset your password by clicking the 'Forgot Password' link on the login page."
        },
        {"answer": "We offer 30-day returns for unused items in original packaging."},
        {"answer": "You can track your order using the tracking number sent to your email."},
    ],
    metadata=[
        {"category": "account", "difficulty": "easy"},
        {"category": "policy", "difficulty": "medium"},
        {"category": "orders", "difficulty": "easy"},
    ],
)
```

```python
versions = client.datasets.get_dataset_versions(dataset="customer-support-qa")
versioned_dataset = client.datasets.get_dataset(
    dataset="customer-support-qa",
    version_id="version-123",
)
```

第一段来自 [CLIENT-PY-DOC]。
第二段来自 [CLIENT-PY-SRC]。
`get_dataset()` 返回对象带 `id`、`examples`、`version_id`。[MIG]

```ts
import { createDataset } from "@arizeai/phoenix-client/datasets";

const { datasetId } = await createDataset({
  name: "support-eval",
  description: "Support questions with expected answers",
  examples: [
    {
      input: { question: "Where is my order?" },
      output: { answer: "Use the tracking page in your account." },
      metadata: { channel: "chat" },
    },
  ],
});
```

这段来自 [CLIENT-TS-DS]。
官方写明 `createDataset()` 按名字 upsert。
要保留旧 example，必须改用 `appendDatasetExamples()`。[CLIENT-TS-DS]

### Task 与 Experiment

产品事实：Task 是用户函数，不是服务端实体。
它接收 Dataset example，返回 JSON 可序列化输出。[EXP-SRC] [CLIENT-TS-EXP]

产品事实：`run_experiment` 先 `POST v1/datasets/{dataset_id}/experiments` 创建 Experiment。
它把当前 `dataset.version_id` 写进 payload 的 `version_id`。[EXP-SRC]

产品事实：创建后的 Experiment 带 `id`、`dataset_id`、`dataset_version_id`。
列表接口还返回 `example_count`、`successful_run_count`、`failed_run_count`、`missing_run_count`。[EXP-SRC]

产品事实：比较页 URL 是一等身份。

```python
# packages/phoenix-client/.../experiments/__init__.py
def get_experiment_url(self, dataset_id: str, experiment_id: str) -> str:
    return urljoin(
        str(self._client.base_url),
        f"datasets/{dataset_id}/compare?experimentId={experiment_id}",
    )
```

这段来自 [EXP-SRC]。

```python
from phoenix.client import Client

client = Client()
dataset = client.datasets.get_dataset(dataset="python quickstart fails")

def my_task(example):
    result = updated_crew.kickoff(inputs=example.input)
    return result

experiment = client.experiments.run_experiment(
    dataset=dataset,
    task=my_task,
    evaluators=evaluators,
)
```

这段来自 [EXP-QS-PY]。
`dry_run=True` 时结果不写入 Phoenix。[EXP-SRC]

```ts
import { runExperiment } from "@arizeai/phoenix-client/experiments";

await runExperiment({
  dataset: { datasetName: "ts quickstart fails" },
  task,
  evaluators: [completenessEvaluator],
  experimentName: "new-experiment",
});
```

这段来自 [EXP-QS-TS]。
返回对象含 `experiment.id`、`projectName`、`runs`、`evaluationRuns`。[CLIENT-TS-EXP]

产品事实：`repetitions` 让每个 example 跑多次。
3 个 example、2 次 repetition，会跑 6 次任务并评 6 次。[EXP-REP]

研究判断：稳定身份是 Dataset 版本、Experiment ID、example ID、OTel trace/span ID。
Task 本身没有持久身份。

## Span、Annotation 与运行事实

### Timing

产品事实：Span 自带 `start_time` 与 `end_time`。[TRACE-WHAT]
Filter 把延迟暴露成 `latency_ms`。[FILTER]

产品事实：用户不必为 Timing 另选图表。
OTel 结束 span 后，时长已经在事实里。

### Usage 与 Cost

产品事实：token 计数走 OpenInference 属性。
自动 instrumentation 会写这些键。手工 instrumentation 必须自己写。[COST]

| 属性 | 类型 | 作用 |
|---|---|---|
| `llm.token_count.prompt` | Integer | prompt token 数 |
| `llm.token_count.completion` | Integer | completion token 数 |
| `llm.token_count.total` | Integer | 合计 |
| `llm.model_name` | String | 模型名 |
| `llm.provider` | String | 提供方 |

表来自 [COST]。
可选细节还包括 cache 与 audio token。[COST] [OI-SPEC]

产品事实：Cost 通常不是用户直接写入的展示值。
Phoenix 用 token 与模型价目表计算，再汇总到 span、trace、session、experiment。[COST]

产品事实：OpenInference 也保留 `llm.cost.*` 键。
规范把它们定义为 USD 成本。[OI-SPEC]
Phoenix 文档的默认路径仍是「写 token，由服务端算 cost」。[COST]

### Score、Evidence、Artifact

产品事实：Evaluator 可以返回多种形状。
官方把它归一成可选的 `score`、`label`、`explanation`、`metadata`。[EXP-SRC] [EXP-EVAL]

```python
def my_evaluator(output, input, expected, metadata):
    score = calculate_similarity(output, expected)
    return {"score": score, "label": "pass" if score > 0.8 else "fail"}
```

这段来自 [CLIENT-PY-SRC]。
函数还可以只返回 `bool`、`float`、`str`，或 `(float, str)`。[EXP-SRC]

```ts
asExperimentEvaluator({
  name: "matches",
  kind: "CODE",
  evaluate: async ({ output, expected }) => {
    const matches = output === expected?.text;
    return {
      label: matches ? "matches" : "does not match",
      score: matches ? 1 : 0,
      explanation: matches
        ? "output matches expected"
        : "output does not match expected",
      metadata: {},
    };
  },
});
```

这段来自 [CLIENT-TS-EXP]。

产品事实：写回 Trace 时，Annotation 信封是固定的。

```json
{
  "span_id": "67f6740bbe1ddc3f",
  "name": "correctness",
  "annotator_kind": "HUMAN",
  "result": {
    "label": "correct",
    "score": 0.85,
    "explanation": "The response answered the question I asked"
  },
  "metadata": {
    "model": "gpt-4",
    "threshold_ms": 500,
    "confidence": "high"
  },
  "identifier": "user-123"
}
```

这段来自 [ANN-SDK]。
`identifier` 用于同名 annotation 的 upsert。[ANN-SDK]

产品事实：OpenInference 把 `annotation.explanation` 写成 “Reason or evidence for the result”。[OI-SPEC]
公开面没有名为 `Evidence` 或 `Artifact` 的独立 SDK 类型。

产品事实：输入输出作为 `input.value` / `output.value` 写在 span 上。[OI-SRC]
多模态内容有单独文档。
本次检查的一手公开面未提供通用 Artifact 仓库。

## OpenInference 属性与 Annotation 扩展面

产品事实：用户至少有四条公开扩展缝。

| 缝 | 扩展单位 | 是否版本化 schema |
|---|---|---|
| OpenInference 保留名 | 固定键，例如 `session.id`、`llm.token_count.total` | 规范说约定稳定，破坏性变更会版本化。[OTEL-SEM] |
| `metadata` JSON | 字符串键到任意 JSON 值 | 不是用户 schema 版本 |
| `tag.tags` | 字符串列表 | 不是用户 schema 版本 |
| 任意 OTel 属性 | 任意键值 | 不是用户 schema 版本 |
| Annotation | 名字 + 固定信封 | 名字是字符串，信封固定 |
| Dataset example `metadata` | 任意字典 | Dataset 版本固定 example，不固定字段 schema |
| `experiment_metadata` | `Mapping[str, Any]` | 不是用户 schema 版本 |

```python
from phoenix.otel import using_metadata, using_attributes

metadata = {"key-1": value_1, "key-2": value_2}
with using_metadata(metadata):
    ...
    # "metadata" = JSON 序列化后的字符串
```

```ts
import { context, setMetadata } from "@arizeai/phoenix-otel";

context.with(
  setMetadata(context.active(), { key1: "value1", key2: "value2" }),
  () => {
    // "metadata" = '{"key1": "value1", "key2": "value2"}'
  },
);
```

两段来自 [OTEL-ATTR]。
`using_attributes` 只能设置 session、user、metadata、tags 与 prompt template。[OTEL-ATTR]

产品事实：Filter 把未识别标识符当成属性路径。
拼写错误会去读一个不存在的属性，结果是匹配不到，而不是报错。[FILTER]

产品事实：Dataset「没有类型」。
作者自己决定 `inputs` / `outputs` 里放哪些键。[DS-CONCEPT]

研究判断：用户扩展的是名字和值、固定信封，以及任意属性。
不是版本化 schema。
Dataset 版本管的是 example 集合，不管自定义字段的代际。

## Tracing 写入与预置展示的绑定关系

产品事实：写 Trace 时，用户写 span 属性，不声明图表。[OTEL-INST] [COST]

产品事实：OpenInference 的 `openinference.span.kind` 会改变 UI 如何组装与渲染 span。[OTEL-SEM] [OTEL-INST]
这是约定绑定展示，不是作者在写入时挑选柱状图。

产品事实：UI Annotation 要先在 Settings 建 rubric。
类型是 Categorical、Continuous 或 Freeform。[ANN-UI]
这只约束人在 UI 里怎么打分，不约束 OTel 写入。

产品事实：Metrics Dashboard 是预置索引。
作者不能在写入 API 里声明一张新 Dashboard。[METRICS]

研究判断：写入大体中立。
真正绑展示的是 span kind 约定、annotation 名字，以及预置 Dashboard 认识哪些官方键。

## Filter Expression、SpanQuery 与 Experiment Compare

产品事实：分析入口是 Filter Expression 与 `SpanQuery`。
UI 过滤条与 Python `SpanQuery().where(...)` 共用 span 过滤语言。[FILTER] [EXPORT]

```python
from phoenix.client import Client
from phoenix.client.types.spans import SpanQuery

client = Client()
query = SpanQuery().where("span_kind == 'LLM'")
filtered_df = client.spans.get_spans_dataframe(
    query=query,
    project_identifier="my-llm-app",
    limit=500,
)
```

这段来自 [CLIENT-PY-SRC]。

```python
from phoenix.client import Client
from phoenix.trace.dsl import SpanQuery

client = Client()
query = SpanQuery().where(
    "span_kind == 'RETRIEVER'",
).select(
    input="input.value",
).explode(
    "retrieval.documents",
    reference="document.content",
)
client.spans.get_spans_dataframe(query=query)
```

这段来自 [EXPORT]。

产品事实：缺失值与 Python 不同。
`attributes['user.tier'] != 'premium'` 不会匹配缺少该属性的 span。
必须写 `is None`。[FILTER]

产品事实：`annotations['correctness'].label is None` 用来找还没写过该 annotation 的 span。[FILTER] [EXPORT]

产品事实：REST list / search 只用离散查询参数。
它们不接受 Filter Expression。[FILTER]

产品事实：Experiment 列表暴露 `successful_run_count`、`failed_run_count`、`missing_run_count`。[EXP-SRC]
这是公开的 partial / missing 计数。

产品事实：Experiment Compare 有单独的过滤语言。
它不是 span / session filter。[FILTER]
本次检查的一手公开面未提供这套语言的完整语法页。

产品事实：公开面没有 NiceEval 式 Sample 分母。
选择范围靠 project、时间窗、Dataset 版本、split 与 filter。

## Metrics Dashboard 与 Experiments 视图

产品事实：预置 Metrics Dashboard 自动包含 traces 数量、延迟分位、cost、token、错误与 annotation 均分。[METRICS]

产品事实：需要自定义 alerting 或给非开发者看的 Dashboard 时，官方指向 Arize AX。[METRICS]

产品事实：Experiment 完成后，作者打开 Experiments 视图比较新旧输出与评价。[EXP-QS-PY] [EXP-QS-TS]
Client 打印的稳定入口是 `datasets/{id}/compare?experimentId={id}`。[EXP-SRC]

产品事实：2026-08-04 发行说明给 Metrics 页加了 span / trace / session annotation 图。
每张图画均分随时间变化。
这是滚动发行说明，不是一份可冻结的 Report API。

产品事实：报告作者没有 `ReportData` 一类公开声明。
代码侧导出 DataFrame，UI 侧消费预置图与 Compare 页。

研究判断：Phoenix 的「报告作者」几乎等于「会用 UI 的人」或「把 DataFrame 拿去别处画图的人」。
它不是 NiceEval 那种 typed Report 层。

## Client、服务端与数据库升级

产品事实：服务端升级说明写在 `MIGRATION.md`。
v19.x 到 v20.0.0 写明无需操作。[MIG] [20.1.0 Release](https://github.com/Arize-ai/phoenix/releases/tag/arize-phoenix-v20.1.0)

产品事实：数据库变更走 Alembic。
旧版本迁移示例要求进入 `phoenix/src/phoenix/db/` 后执行 `alembic upgrade head`。[MIG]
v18 的 sessions 索引迁移可用 `PHOENIX_MIGRATE_INDEX_CONCURRENTLY=true`。[MIG]

产品事实：Client 升级会改名字，不要求重写历史 traces。
`phoenix.experiments` 迁到 `phoenix.client.experiments`。
旧「evaluations」在新 Client 里改叫 annotations。[MIG]

```python
# After
from phoenix.client.__generated__.v1 import DatasetExample as Example
from phoenix.client.experiments import create_evaluator, run_experiment, evaluate_experiment

experiment = run_experiment(dataset=dataset, task=task, evaluators=[...])
experiment = evaluate_experiment(experiment=experiment, evaluators=[...])
```

这段来自 [MIG]。

产品事实：已完成的 Experiment 可以再评一次，不必重跑 Task。

```python
experiment = get_experiment(experiment_id="123")
evaluated = evaluate_experiment(
    experiment=experiment,
    evaluators=[accuracy_evaluator],
    print_summary=True,
)
```

这段来自 [CLIENT-PY-SRC]。

产品事实：Dataset 版本让旧 Experiment 继续固定旧 example 集合。[DS-CONCEPT] [CLIENT-PY-SRC]

本次检查的一手公开面未提供：用户自定义属性的 schema 代际、把旧 span payload 迁到新字段图、按 family 出具 migration receipt。

研究判断：Phoenix 迁的是服务端表与 SDK 入口。
它不把用户自定义事实当成版本化 RecordAttachment family。

## Phoenix 的使用者界面

| 角色 | 公开入口 | 需要理解的层 | 不必看见的层 |
|---|---|---|---|
| 普通应用作者 | `phoenix.otel.register`、auto-instrument、领域 Agent 代码 | 1 层：把运行发到 project | Dataset 版本、Alembic、Annotation 信封 |
| 扩展作者 | 自定义 evaluator、annotation config、任意属性或 `metadata` | 1 到 2 层：函数返回信封，或 UI rubric | 没有 adapter SPI，也没有 sealed domain value |
| 分析作者 | `SpanQuery`、`get_spans_dataframe`、pandas | 1 层：过滤表达式与列选择 | Record reader、projection graph |
| 报告作者 | Metrics Dashboard、Experiment Compare、导出后的 DataFrame | 1 层：选预置图或自己拿表 | `ReportData`、semantic component |

产品事实：普通应用作者可以只跑下面这段，就让一次真实执行进入 Phoenix。[TRACE-QS]

```python
os.environ["PHOENIX_COLLECTOR_ENDPOINT"] = "http://localhost:6006"
tracer_provider = register(project_name="crewai-tracing-quickstart", auto_instrument=True)
result = crew.kickoff(inputs=user_inputs)
```

产品事实：扩展作者若要自定义分数，写函数即可。[EXP-EVAL]
若要在 UI 里规范人工打分，再加 annotation config。[ANN-UI]
两套入口互不推导。

产品事实：分析作者面对的是字符串过滤语言，不是 typed Dimension / Measure。[FILTER] [EXPORT]

产品事实：报告作者没有独立公共 API。
官方把自定义 Dashboard 交给 Arize AX。[METRICS]

研究判断：Phoenix 用「约定键 + UI」压扁了 NiceEval 想分开的三层。
代价是自定义事实没有 schema 主人，报告也没有作者面。

## 四个 NiceEval 场景

### 官方 OTel Timing

产品事实：这条路径是完整的。
用户注册 tracer，跑真实代码，OTel 写下 `start_time` / `end_time`。
同一产品用 `latency_ms` 过滤，并在 Metrics Dashboard 画延迟分位。[TRACE-QS] [FILTER] [METRICS]

产品事实：Cost 是衍生值。
作者写 `llm.token_count.*` 与模型名，Phoenix 再算 USD。[COST]

NiceEval 建议：官方 Timing 应像 Phoenix 这样对普通作者不可见。
作者配置 tracing，不构造版本化 timing document。
与 Phoenix 不同，NiceEval 应把封口后的 Timing 收成领域 sealed value，再经 adapter 变成 RecordAttachment。

### 用户 GPU Energy

产品事实：本次检查的一手公开面未提供 GPU Energy、焦耳或 NVML 一类领域类型。

产品事实：作者只能把读数放进 `metadata` JSON，或写成任意 span 属性。
Filter 可以按 `metadata['gpu_energy_j']` 或未知属性路径读取。[OTEL-ATTR] [FILTER]

产品事实：预置 Dashboard 不会因此多出一张 Energy 图。[METRICS]
分析作者必须自己导出 DataFrame，再在 Phoenix 外聚合。

研究判断：这正好暴露任意属性袋的上限。
值能进去，也能被字符串过滤捞出来。
它没有 schema 身份、没有 migration、没有官方 measure。

NiceEval 建议：GPU Energy 必须走领域 SDK 与 RecordAttachment adapter。
不要学 Phoenix 把新事实写成一个 JSON 键。

### Assertion 与 Evidence

产品事实：Phoenix 的判定单位是 evaluator 与 Annotation。
公开 Client 不导出名为 `Assertion` 的类型。

产品事实：最近的证据字段是 `explanation`。
OpenInference 明确把它写成 reason or evidence。[OI-SPEC] [ANN-SDK]

```python
client.spans.add_span_annotation(
    span_id="span-123",
    annotation_name="helpfulness",
    annotator_kind="HUMAN",
    label="helpful",
    score=0.9,
    explanation="Response directly answered the user's question",
)
```

这段来自 [CLIENT-PY-SRC]。

产品事实：同一 span 可以有多条同名 annotation。
没有不同 `identifier` 时，API 会替换旧 annotation。[ANN-SDK]

NiceEval 建议：可以吸收「名字 + score/label/explanation + metadata」这个信封。
不要把它当成 AssertionResult。
NiceEval 的 Evidence 应绑定 subject 与 evaluator，而不是只挂在 span 上的一段说明。

### 旧数据升级后重新分析和报告

产品事实：服务端用 Alembic 迁自己的表与索引。[MIG]
Dataset 版本固定旧 Experiment 的分母。[DS-CONCEPT]
`evaluate_experiment` 可以在旧 Experiment 上补新 evaluator。[CLIENT-PY-SRC]

产品事实：Client 改名后，旧 traces 仍按 span 与 annotation 读取。
旧 `log_evaluations` 对应新的 `log_span_annotations`。[MIG]

本次检查的一手公开面未提供：把历史自定义属性迁到新键、按 family 授权重写、升级后自动重编译 Report。

研究判断：Phoenix 能「旧数据上再跑一次分析」，因为它把分析做成查询与补评。
它不能「旧 schema 升到新 schema 后再用同一套 Report 声明重出报告」。

NiceEval 建议：保留 Phoenix 的「固定分母、事后补评」。
补上 Phoenix 没有的显式 migration plan、authorization 与 receipt。

## 产品事实、研究判断与 NiceEval 建议

### 产品事实

- 用户代码真实运行。Task 是函数，Trace 是 OTel 运行事实集合。
- 同一 Phoenix 服务接收 OTLP，并提供 Dataset、Experiment、Annotation、Filter 与预置 Dashboard。
- Dataset 版本化。Experiment 创建时固定 `version_id`。
- 官方 Timing 与 token 走 OpenInference 键。Cost 默认由服务端计算。
- 自定义事实走 `metadata`、tags、任意属性或 Annotation 信封。
- 写入不要求先选图表。span kind 与预置 Dashboard 会绑定部分展示。
- 缺失值必须用 `is None`。未知属性名静默匹配不到。
- 历史升级走 Alembic 与 Client 迁移说明。用户事实没有 schema family。

### 研究判断

- Phoenix 是完整 eval 平台，不是 BI。
- 它的作者心智是「先按约定写，再靠 UI 与查询读」。
- 四类作者看到的层数都很少，因为产品没有把 Record、Analysis、Report 分成三套公共 API。
- 这对普通应用作者很友好。对领域扩展与可重复报告不够。

### NiceEval 建议

- 吸收：同一产品读写、Dataset 或题集版本固定比较总体、事后补评、缺失值显式化。
- 吸收：普通作者只碰领域 API 与 tracing 配置。
- 拒绝：用任意属性袋代替版本化 RecordAttachment。
- 拒绝：用预置 Dashboard 代替 typed Report。
- 拒绝：让展示约定反向决定写入信封。
- 补齐：adapter、installation、显式 migration，以及 Analysis field 与 Report 声明。

## 值得吸收 / 不应复制 / 尚缺证据

### 值得吸收

- 用户函数真实执行，SDK 写入，同一产品读取。这是 Record → Analysis → Report 的外部存在证明。
- Experiment 固定 Dataset `version_id`。比较有固定分母。
- Annotation 用固定信封，名字与 `identifier` 分开。
- `evaluate_experiment` 允许旧运行上补新分数。
- Filter 把 missing 与 `!=` 分开。这比静默把空值当 False 更清楚。
- 普通应用作者可以只理解 `register()` 与自己的业务函数。

### 不应复制

- 不要把自定义事实做成无 schema 的属性袋。
- 不要让 span kind 或预置 Dashboard 成为唯一展示面。
- 不要让 Task 只活在 Client 进程里、却没有持久身份。
- 不要用 `explanation` 字符串代替独立 Evidence。
- 不要让未知属性名静默失败，却不告诉作者键不存在。
- 不要把服务端 Alembic 当成用户事实 migration。

### 尚缺证据

- 任意属性是否在所有查询与导出路径上无损保留。
- OpenInference 约定变更时，历史 span 会不会被重写。
- Experiment Compare 过滤语言的完整语法。
- Annotation `metadata` 能否像 `result.score` 一样被一等过滤。
- TypeScript Client 是否提供与 Python 同等的 `version_id` 读取与固定 API。
- Phoenix OSS 是否计划提供用户声明的 Dashboard 或 Report。
- GPU、能耗、主机资源这类非 LLM 事实，官方是否准备一等键。

这些缺口都不妨碍以下研究判断。
Phoenix 证明完整 eval 平台必须让用户代码跑起来，并让同一产品读回这些事实。
它没有证明任意属性与预置图可以替代版本化 Record 与 typed Report。
