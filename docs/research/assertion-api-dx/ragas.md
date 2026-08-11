# Ragas 的 Metric、Judge 与聚合作者指南

> 观察日期：2026-08-09。本文以 Ragas `0.4.3`、tag commit
> `4ecab384fda829ca50bec3f07cc49589d756e172` 为固定代码一手材料。
> 官网文档持续更新；文档与该 commit 冲突时，本文以固定代码为准并指出差异。

## 1. 定位与真实边界

### 官方事实

Ragas 是 Python 的 LLM 应用 eval 库。它把“怎样评价一条回答或一段 Agent 对话”写成 Metric，
把多行输入与输出写成 Dataset 或 Experiment。它不是 Jest 式断言库，也不提供统一的 `expect()`。
[官方仓库](https://github.com/vibrantlabsai/ragas/tree/4ecab384fda829ca50bec3f07cc49589d756e172)
把产品描述为 RAG 与 LLM 应用的 evaluation framework。

`0.4.3` 有两套公开作者面，而且两者不能混用：

| 作者面 | 数据 | Metric 协议 | 批量入口 | 状态 |
| --- | --- | --- | --- | --- |
| collections | 灵活的 `Dataset` 行 | `ascore(**fields) -> MetricResult` | `@experiment().arun()` | `0.4` 推荐形状 |
| legacy | `EvaluationDataset` 中同类的 `SingleTurnSample` 或 `MultiTurnSample` | `single_turn_ascore()` / `multi_turn_ascore()` 返回 `float` | `evaluate()` / `aevaluate()` | deprecated |

collections 类继承 [`ragas.metrics.collections.BaseMetric`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/collections/base.py)。
`evaluate()` 却只接受 legacy [`Metric`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/base.py)。
把 collections 的 `ExactMatch()` 传给 `evaluate()` 会得到 `TypeError`，不是兼容调用。

Ragas 的公开 Metric 可分为五类：

1. 字符串、BLEU、CHRF、ROUGE、表格比较等确定性算法；
2. 依赖 embedding 的语义相似度与回答相关性；
3. 依赖 LLM Judge 的正确性、忠实度、检索质量、rubric 与 SQL 指标；
4. 面向多轮对话、Agent 目标、tool call 与主题遵循的指标；
5. `DiscreteMetric`、`NumericMetric`、`RankingMetric` 和装饰器形式的自定义指标。

公开 API 没有名为 `Scorer` 或 `Grader` 的顶层协议。
Ragas 用 Metric 表示每项求值规则；本文只把实际调用 LLM 的 Metric 称为 Judge。

它不负责运行被测程序、创建 Sandbox、采集任意事件流或判断进程副作用。
`ToolCallAccuracy` 读取作者提供的消息和参照 tool call；它不会执行工具，也不会核对工具对外部系统的影响。

Ragas 也没有统一的 pass、fail、skip、unavailable 或阈值字段。
现代 `MetricResult` 只承载 `value`、`reason` 与可选 `traces`。
是否通过、怎样加权、缺分是否使 CI 失败，都由实验函数或 CI 脚本定义。

### 研究判断

Ragas 最像“每行直接求值的 Metric 集合，加上一张可自由扩充的实验结果表”。
它的 RAG 与 Agent 指标很丰富，但 `0.4.3` 正处于协议切换期。
初学者需要先选 collections 或 legacy，再阅读对应示例。

本文优先教授 collections 与 `@experiment`。
legacy 部分仍完整列出，因为 `evaluate`、`RunConfig`、单轮与多轮 Sample 仍是公开 API，
而且官网若干入门页仍在使用它们。

## 2. 观察版本和一手链接

### 2.1 固定快照

| 项目 | 观察值 | 官方材料 |
| --- | --- | --- |
| Python 包 | `ragas==0.4.3`；要求 Python `>=3.9` | [PyPI 0.4.3](https://pypi.org/project/ragas/0.4.3/) |
| wheel | 2026-01-13 上传；SHA-256 `ef1d75f674c294e9a6e7d8e9ad261b6bf4697dad1c9cbd1a756ba7a6b4849a38` | [PyPI JSON](https://pypi.org/pypi/ragas/0.4.3/json) |
| sdist | 2026-01-13 上传；SHA-256 `1eb1f61dbc8613ad014fdb8d630cbe9a1caec1ea01664a106993cb756128c001` | [PyPI JSON](https://pypi.org/pypi/ragas/0.4.3/json) |
| Git tag | `v0.4.3` 指向 `4ecab384fda829ca50bec3f07cc49589d756e172` | [固定源码树](https://github.com/vibrantlabsai/ragas/tree/4ecab384fda829ca50bec3f07cc49589d756e172) |
| 观察日 `main` | `298b68274234c060deacab3cf5fb52aa3a20e885` | [main commit](https://github.com/vibrantlabsai/ragas/commit/298b68274234c060deacab3cf5fb52aa3a20e885) |
| 官网文档 | 滚动站点，不与 `0.4.3` tag 一一绑定 | [stable 文档](https://docs.ragas.io/en/stable/) |

### 2.2 一手材料索引

后文的 signature、默认值和边界由下列固定文件核对。
每个 Metric 表格还会直接链接到自己的实现文件。

| 编号 | 核对内容 | 固定版本材料 | 易读网页 |
| --- | --- | --- | --- |
| R1 | 包依赖、Python 要求、可选依赖、backend 入口 | [`pyproject.toml`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/pyproject.toml) | [安装](https://docs.ragas.io/en/stable/getstarted/install/) |
| R2 | collections 导出、公共基类、结果对象 | [`collections/__init__.py`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/collections/__init__.py) · [`base.py`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/collections/base.py) · [`result.py`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/result.py) | [Metric reference](https://docs.ragas.io/en/stable/references/metrics/) |
| R3 | 通用 Judge Metric、装饰器与值校验 | [`discrete.py`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/discrete.py) · [`numeric.py`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/numeric.py) · [`ranking.py`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/ranking.py) · [`decorator.py`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/decorator.py) | [通用 Metric](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/general_purpose/) |
| R4 | LLM 与 embedding 工厂 | [`llms/base.py`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/llms/base.py) · [`embeddings/base.py`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/embeddings/base.py) | [LLM adapters](https://docs.ragas.io/en/stable/howtos/llm-adapters/) |
| R5 | 灵活 Dataset、Experiment 与本地保存 | [`dataset.py`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/dataset.py) · [`experiment.py`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/experiment.py) · [`backends`](https://github.com/vibrantlabsai/ragas/tree/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/backends) | [Experiments](https://docs.ragas.io/en/stable/concepts/experimentation/) · [Datasets](https://docs.ragas.io/en/stable/concepts/datasets/) |
| R6 | 单轮、多轮、消息与 legacy 结果 schema | [`dataset_schema.py`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/dataset_schema.py) · [`messages.py`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/messages.py) | [Evaluation schema](https://docs.ragas.io/en/stable/references/evaluation_schema/) |
| R7 | `evaluate`、执行器、超时与重试 | [`evaluation.py`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/evaluation.py) · [`executor.py`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/executor.py) · [`run_config.py`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/run_config.py) | [`evaluate` reference](https://docs.ragas.io/en/stable/references/evaluate/) · [`RunConfig`](https://docs.ragas.io/en/stable/references/run_config/) |
| R8 | legacy 导出、Metric 协议与兼容名 | [`metrics/__init__.py`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/__init__.py) · [`metrics/base.py`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/base.py) · [legacy 实现目录](https://github.com/vibrantlabsai/ragas/tree/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics) | [0.3 到 0.4 迁移](https://docs.ragas.io/en/stable/howtos/migrations/migrate_from_v03_to_v04/) |
| R9 | 首个 `@experiment` 的官方形状 | [`experiments_quickstart.md`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/docs/getstarted/experiments_quickstart.md) | [Experiment quickstart](https://docs.ragas.io/en/stable/getstarted/experiments_quickstart/) |

“官方事实”指固定源码、PyPI 元数据或官网文字。
“研究判断”指本文依据这些材料做的作者体验分析。
滚动网页与固定源码不一致的项目集中放在第 12 节。

## 3. 安装、最小项目与首个可运行 eval

### 3.1 安装时必须处理的依赖问题

官方包声明 `langchain-community` 时没有上限，见 R1。
在观察日，Python 3.12.13 新目录安装 `ragas==0.4.3` 会选到 `langchain-community==0.4.2`。
随后仅执行 `import ragas` 就会因已删除的 VertexAI 模块路径而失败。

官方 issue [#2753](https://github.com/vibrantlabsai/ragas/issues/2753) 在观察日仍为 open。
固定源码中的无条件导入位于 [`llms/base.py`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/llms/base.py#L12)。
这不是使用 VertexAI 才会触发的错误。

以下组合是本文在 Python 3.12.13 上实际探测成功的临时约束：

```text
ragas==0.4.3
langchain-community==0.3.31
```

`0.3.31` 也出现在该官方 issue 的成功探测中。
它不是维护者发布的正式修复，因此项目应把这条约束和 Ragas 版本一起保存在依赖文件里。

### 3.2 最小项目

```text
ragas-demo/
├── requirements.txt
└── eval.py
```

`requirements.txt`：

```text
ragas==0.4.3
langchain-community==0.3.31
```

安装：

```bash
cd ragas-demo
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

### 3.3 首个可运行 eval

把下列内容保存为 `eval.py`。它只使用确定性 `ExactMatch`，不需要模型密钥。
调用形状来自 R9，import 与参数以 R2 的固定源码为准。

```python
import asyncio

from ragas.metrics.collections import ExactMatch


async def main() -> None:
    metric = ExactMatch()
    result = await metric.ascore(reference="Paris", response="Paris")
    print(result.value)
    print(result.reason)


asyncio.run(main())
```

运行：

```bash
python eval.py
```

输出：

```text
1.0
None
```

`ascore()` 是 collections 的主要入口。
在没有运行中 event loop 的同步程序里，也可调用 `metric.score(...)`。
已经位于 async 函数时调用 `score()` 会抛 `RuntimeError`，应继续使用 `await ascore(...)`，见 R2。

## 4. 核心数据流与对象关系

### 4.1 collections 与 Experiment

现代路径的数据流如下：

```text
Dataset row
  -> @experiment 包装的函数
  -> 被测应用得到 response / messages / contexts
  -> 一个或多个 metric.ascore(**fields)
  -> MetricResult(value, reason, traces)
  -> 作者返回一行 dict 或 Pydantic model
  -> Experiment 保存到 backend
```

`@experiment` 会为每行创建 async task，并按完成先后把返回行加入 `Experiment`。
因此结果行次序不保证与 Dataset 相同。每行应带稳定 `id`，分析前再按 `id` 对齐。
[固定实现](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/experiment.py#L116-L198)
还显示：单行抛错时只打印 warning，该行不会进入结果表；其余行继续运行。

Experiment 不会自动寻找 Metric，也不会自动保存 `MetricResult`。
实验函数必须把 `.value`、`.reason`、模型名、应用 trace URI 和所需 artifact 字段放进返回值。

### 4.2 legacy evaluate

旧路径的数据流如下：

```text
EvaluationDataset
  -> 同类 SingleTurnSample 或同类 MultiTurnSample
  -> evaluate() / aevaluate()
  -> legacy Metric.required_columns 校验
  -> Executor 按 row x metric 派发
  -> float，或失败时 np.nan
  -> EvaluationResult
```

`evaluate()` 是同步包装；`aevaluate()` 是 async 入口。两者在 `0.4.3` 都发出 `DeprecationWarning`，
并指向 `@experiment`。固定签名与警告见 R7。

### 4.3 对象总表

| 对象 | signature 或字段 | 职责与边界 |
| --- | --- | --- |
| `Dataset` | `Dataset(name, backend, data_model=None, data=None, **backend_kwargs)` | 任意 dict 或 Pydantic 行；为现代 Experiment 服务 |
| `Experiment` | 与 `Dataset` 相同；通常由 `.arun()` 创建 | 保存实验函数返回的行；本身没有内建聚合 |
| `MetricResult` | `MetricResult(value, reason=None, traces=None)` | 单次 Metric 输出；没有阈值、通过态或跳过态 |
| `EvaluationDataset` | `EvaluationDataset(samples, backend=None, name=None)` | legacy typed dataset；所有 Sample 必须同类 |
| `SingleTurnSample` | 见下表 | legacy 单轮字段容器 |
| `MultiTurnSample` | 见下表 | legacy 多轮消息、参照目标与 tool call 容器 |
| `EvaluationResult` | `scores, dataset, binary_columns=[], cost_cb=None, traces=[], ragas_traces={}, run_id=None` | legacy 行分数、均值展示、成本与 callback trace |
| `RunConfig` | `timeout=180, max_retries=10, max_wait=60, max_workers=16, exception_types=(Exception,), log_tenacity=False, seed=42` | legacy evaluate、重试包装与部分 legacy provider 设置 |

`Dataset` 的内建 backend 名是 `local/csv`、`local/jsonl`、`inmemory`、`gdrive`，见 R1 与 R5。
本地 backend 还需要 `root_dir`。CSV 会把复杂值写成字符串；JSONL 保留 list、dict、数字、布尔值与 `None`，
所以含消息、reason、trace 或 artifact metadata 时应优先 JSONL。

`Dataset.load()`、`Dataset.from_pandas()`、`save()` 与 `reload()` 负责读取和保存。
`validate_with()`、`to_pandas()` 与 `train_test_split(test_size=0.2, random_state=None)` 负责校验、转换和切分，见 R5。
`Experiment.load()` 使用同样的 backend 参数读取实验结果。

### 4.4 单轮与多轮字段

[`SingleTurnSample`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/dataset_schema.py#L55-L99)
的全部字段都是可选：

| 字段 | 类型 | 直接使用者 |
| --- | --- | --- |
| `user_input` | `str | None` | 问题、指令、单轮 Judge |
| `retrieved_contexts` | `list[str] | None` | 忠实度、检索 precision、检索 recall |
| `reference_contexts` | `list[str] | None` | 上下文参照、摘要指标 |
| `retrieved_context_ids` | `list[str | int] | None` | legacy ID precision / recall |
| `reference_context_ids` | `list[str | int] | None` | legacy ID precision / recall |
| `response` | `str | None` | 被测回答 |
| `multi_responses` | `list[str] | None` | 需要多个候选回答的自定义 Metric |
| `reference` | `str | None` | 参照回答 |
| `rubrics` | `dict[str, str] | None` | 每行 rubric |
| `persona_name` | `str | None` | 数据 metadata |
| `query_style` | `str | None` | 数据 metadata |
| `query_length` | `str | None` | 数据 metadata |

[`MultiTurnSample`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/dataset_schema.py#L102-L174)
要求 `user_input` 是 `HumanMessage | AIMessage | ToolMessage` 列表。
其余字段是 `reference`、`reference_tool_calls`、`rubrics` 与 `reference_topics`。

消息包含 `HumanMessage(content, metadata=None)` 与
`AIMessage(content, tool_calls=None, metadata=None)`。
另有 `ToolMessage(content, metadata=None)` 和 `ToolCall(name, args)`，
见 [messages.py](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/messages.py)。
`ToolMessage` 前面必须出现发起 tool call 的 `AIMessage`；相邻次序不合法会在 Sample 校验时抛错。

`EvaluationDataset.from_list(data, backend=None, name=None)` 会按 `user_input` 是否为 list 推断单轮或多轮。
它还提供 `from_dict()`、`from_hf_dataset()`、`from_pandas()`、`from_jsonl()`，
以及对应的 `to_list()`、`to_hf_dataset()`、`to_pandas()`、`to_csv()`、`to_jsonl()`，见 R6。
`backend` 与 `name` 字段不会像现代 `Dataset.save()` 那样自动保存内容。

## 5. 完整 API catalog

### 5.1 两套 Metric protocol

#### collections protocol

所有 collections 内建类都提供同一组方法，见 R2：

```python
async def ascore(**kwargs) -> MetricResult: ...
def score(**kwargs) -> MetricResult: ...
async def abatch_score(inputs: list[dict[str, Any]]) -> list[MetricResult]: ...
def batch_score(inputs: list[dict[str, Any]]) -> list[MetricResult]: ...
```

`ascore()` 是内建类真正实现的方法。`score()` 用 `asyncio.run()` 包装它。
`abatch_score()` 通过 `asyncio.gather()` 并发调用；单项异常会使整个 gather 抛错。
内建类没有共同的 retry、skip 或异常转分策略。

collections 中带 `llm` 的类要求 `InstructorBaseRagasLLM`；带 `embeddings` 的类要求现代
`BaseRagasEmbedding`。传入 legacy wrapper 会在构造时得到 `ValueError`。

#### legacy protocol

legacy 抽象面来自 R8：

```python
class Metric:
    def init(run_config: RunConfig) -> None: ...

class SingleTurnMetric(Metric):
    def single_turn_score(sample, callbacks=None) -> float: ...
    async def single_turn_ascore(sample, callbacks=None, timeout=None) -> float: ...
    async def _single_turn_ascore(sample, callbacks) -> float: ...

class MultiTurnMetric(Metric):
    def multi_turn_score(sample, callbacks=None) -> float: ...
    async def multi_turn_ascore(sample, callbacks=None, timeout=None) -> float: ...
    async def _multi_turn_ascore(sample, callbacks) -> float: ...
```

自定义 legacy 类实现 `init()` 和对应的私有 async 方法。
公开 async 方法用 `asyncio.wait_for()` 实施单次 timeout；同步方法会应用 `nest_asyncio`。

R8 还导出下列协议辅助类型：

| 公开名字 | 固定形状与语义 |
| --- | --- |
| `MetricType` | `SINGLE_TURN="single_turn"`、`MULTI_TURN="multi_turn"`；用于 `required_columns` 的键 |
| `MetricOutputType` | `BINARY`、`DISCRETE`、`CONTINUOUS`、`RANKING`；只是 legacy metadata，不产生阈值或通过态 |
| `MetricWithLLM` | `MetricWithLLM(_required_columns={}, name="", llm=None, output_type=None)`；`init()` 在 LLM 缺失时抛 `ValueError` |
| `MetricWithEmbeddings` | `MetricWithEmbeddings(_required_columns={}, name="", embeddings=None)`；`init()` 在 embedding 缺失时抛 `ValueError` |
| `ragas.metrics.BaseMetric` | legacy 根模块把它指向 `SimpleBaseMetric(name, allowed_values=...)`，不是 collections 的同名类 |
| `ragas.metrics.LLMMetric` | `SimpleLLMMetric(name, allowed_values=..., prompt=None)` 的别名；是三种通用 LLM Metric 的父类 |

这两个 `BaseMetric` 的 import 路径不同。
现代内建 Metric 或现代自定义子类应从 `ragas.metrics.collections` 导入；
通用装饰器协议与 `MetricResult` 从 `ragas.metrics` 导入。

### 5.2 `MetricResult`、通用 Metric 与装饰器

[`MetricResult`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/result.py)
的 `value` 可为字符串、数字、列表或 `None`。
`reason` 是可选文字，`traces` 只允许 `input` 与 `output` 两个键。
`to_dict()` 返回 `{"result": value, "reason": reason}`，不会加入 traces。

它会转发数值运算、比较、字符串方法和列表访问。
作者仍应在保存或聚合前显式读取 `.value`，以免把包装对象交给不认识它的序列化器。

| API | signature / 默认值 | 参数与返回 | 同步、异步与失败语义 |
| --- | --- | --- | --- |
| [`DiscreteMetric`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/discrete.py) | `DiscreteMetric(name, allowed_values=["pass", "fail"], prompt=None)` | 调用 `score/ascore(llm=..., **prompt_fields)`；返回字符串 `MetricResult` | 两种入口都有；无 prompt 或 LLM 故障会抛错；结构化输出由 LLM schema 限定 |
| [`NumericMetric`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/numeric.py) | `NumericMetric(name, allowed_values=(0.0, 1.0), prompt=None)` | 返回浮点 `MetricResult`；tuple 或 `range` 表示允许范围 | 两种入口都有；直接类调用依赖 LLM 的结构化输出 |
| [`RankingMetric`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/ranking.py) | `RankingMetric(name, allowed_values=2, prompt=None)` | `allowed_values` 是结果列表长度；返回 `list[str]` | 两种入口都有；错误由 LLM 调用抛出 |
| `discrete_metric` | `discrete_metric(*, name=None, allowed_values=None, **metric_params)` | 把 sync 或 async 函数变成 Metric；默认函数名与 `pass/fail` | `.score/.ascore` 校验关键字输入；函数异常或值不合法时返回 `value=None` 与 reason |
| `numeric_metric` | `numeric_metric(*, name=None, allowed_values=None, **metric_params)` | 默认范围 `(0.0, 1.0)` | 同上；越界、非数字或函数异常变成 `value=None` |
| `ranking_metric` | `ranking_metric(*, name=None, allowed_values=None, **metric_params)` | 默认要求两个列表项 | 同上；非列表或长度不符变成 `value=None` |

装饰器生成的 Metric 只接受关键字参数。
未知参数会发出 `UserWarning` 后被丢弃；缺字段与类型错误在执行函数前抛 `TypeError`。
直接写 `metric(...)` 会调用原函数并绕过 `MetricResult` 与值校验，应在 eval 中调用 `.score()` 或 `.ascore()`。

直接构造的 `DiscreteMetric` 通过 `Literal` response schema 限定离散值。
直接构造的 `NumericMetric` 与 `RankingMetric` 在固定 `score/ascore` 中没有调用范围或列表长度校验。
只有装饰器生成的 Metric 会执行这两类值校验。

三个 LLM 通用类还提供 `get_variables()`、`save(path=None)`、`load(path, embedding_model=None)`，
并支持 JSON 或 `.gz`。`align()`、`align_and_validate()` 与 `validate_alignment()` 也出现在固定源码，
但官网没有完整 API reference；第 12 节说明这项限制。

### 5.3 LLM、embedding、批量运行与 Dataset API

| API | 固定 signature | 关键默认值与边界 |
| --- | --- | --- |
| `llm_factory` | `llm_factory(model, provider="openai", client=None, adapter="auto", cache=None, **kwargs)` | `client` 与 `model` 必填；返回现代 `InstructorBaseRagasLLM`；`kwargs` 传温度、token 上限等模型参数，见 R4 |
| `embedding_factory` | `embedding_factory(provider="openai", model=None, run_config=None, client=None, interface="auto", base_url=None, cache=None, **kwargs)` | collections 应显式传 client，并用现代接口；旧调用形状会发 `DeprecationWarning`，见 R4 |
| `experiment` | `experiment(experiment_model=None, backend=None, name_prefix="")` | 装饰 sync 或 async 行函数；返回 wrapper，见 R5 |
| `.arun` | `arun(dataset, name=None, backend=None, *args, **kwargs) -> Experiment` | async；并发处理所有行；`name=None` 时生成名字；单行抛错会被省略 |
| `Dataset` | `Dataset(name, backend, data_model=None, data=None, **kwargs)` | backend 必填；可在构造时传行，也可 `append()` 后 `save()` |
| `Dataset.load` | `load(name, backend, data_model=None, **kwargs)` | 读取已保存 Dataset；文件不存在会抛 `FileNotFoundError` |
| `Experiment.load` | `load(name, backend, data_model=None, **kwargs)` | 读取已保存 Experiment；同样要求 backend 参数 |
| `evaluate` | 见下一段 | 同步、deprecated，只接受 legacy Metric 列表 |
| `aevaluate` | 与 `evaluate` 相同，但没有 `allow_nest_asyncio` | async、deprecated，只接受 legacy Metric 列表 |
| `RunConfig` | `RunConfig(timeout=180, max_retries=10, max_wait=60, max_workers=16, exception_types=(Exception,), log_tenacity=False, seed=42)` | 只直接服务 legacy 路径；现代 `@experiment` 不读取它 |

collections 中同时依赖 LLM 与 embedding 的最小构造如下。
使用 async client 可直接配合 Metric 的 `ascore()`：

```python
from openai import AsyncOpenAI

from ragas.embeddings import OpenAIEmbeddings
from ragas.llms import llm_factory
from ragas.metrics.collections import AnswerRelevancy


client = AsyncOpenAI()
llm = llm_factory("gpt-4o-mini", client=client)
embeddings = OpenAIEmbeddings(
    client=client,
    model="text-embedding-3-small",
)
metric = AnswerRelevancy(llm=llm, embeddings=embeddings)
```

[`OpenAIEmbeddings`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/embeddings/openai_provider.py)
是现代 `BaseRagasEmbedding`。
从 `ragas.embeddings` 导入 `embedding_factory` 会发 `DeprecationWarning`；
若确实需要工厂，应从 `ragas.embeddings.base` 导入，或直接构造现代 provider 类。

`evaluate()` 的完整固定签名如下，见 R7：

```python
def evaluate(
    dataset,
    metrics=None,
    llm=None,
    embeddings=None,
    experiment_name=None,
    callbacks=None,
    run_config=None,
    token_usage_parser=None,
    raise_exceptions=False,
    column_map=None,
    show_progress=True,
    batch_size=None,
    _run_id=None,
    _pbar=None,
    return_executor=False,
    allow_nest_asyncio=True,
) -> EvaluationResult | Executor: ...
```

`metrics=None` 会选择 legacy `answer_relevancy`、`context_precision`、`faithfulness`、`context_recall`。
缺少 LLM 时，legacy 路径会创建 OpenAI `gpt-4o-mini`；embedding 也会按 LLM 推断 provider。
在 CI 中应显式传 Metric、LLM 与 embedding，避免依赖隐含模型和凭据。

类型注解把 `metrics` 写成 `Sequence[Metric]`，但固定运行时只接受 `list`。
传 tuple 会抛 `TypeError`；list 中任一对象不是 legacy `Metric` 也会在运行前抛错。

`column_map` 只在 Hugging Face Dataset 输入转换时重命名字段。
`return_executor=True` 返回可调用 `cancel()`、`is_cancelled()`、`results()`、`aresults()` 的执行器。
`batch_size=None` 表示不分批；`show_progress=False` 隐藏进度条。

`RunConfig` 的 retry 使用随机指数等待，最长 `max_wait=60` 秒，尝试上限为 `max_retries=10`。
只重试 `exception_types` 指定的异常。`seed=42` 创建 NumPy RNG。
这些值不会自动改变 collections 内建 Metric 自己的 `max_retries`。

### 5.4 collections：回答、RAG 与摘要 Metric

本节表格列完 `ragas.metrics.collections.__all__` 中这一类的每个公开名字。
所有类都以 async `ascore()` 为主要入口，并继承同步与批量入口。
除 `NoiseSensitivity` 外，数值都是越高越好。

表中的“抛错”表示没有 skip 转换：缺字段、空文本、依赖缺失、请求失败或 Judge schema 不合规时，
异常直接离开 `ascore()`。只有明确写出 `NaN`、`0` 或 reason 的行有另一种行为。

| API 与构造参数 | `ascore` 参数 | 值、算法与依赖 | 失败、跳过与无分 |
| --- | --- | --- | --- |
| [`AnswerAccuracy(llm, name="answer_accuracy", max_retries=5)`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/collections/answer_accuracy/metric.py) | `user_input, response, reference` | 两个 Judge 的准确度结果合并为 `float` | 单个 Judge 可在本地重试；两个都无有效值时为 `NaN`；没有 skip |
| [`AnswerCorrectness(llm, embeddings=None, name="answer_correctness", weights=[0.75, 0.25], beta=1.0)`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/collections/answer_correctness/metric.py) | `user_input, response, reference` | `weights` 依次控制 factuality 与语义相似度；`[1.0, 0.0]` 可免 embedding | 权重须为两个非负值且不能全零；需相似度却未传 embedding 时抛错 |
| [`AnswerRelevancy(llm, embeddings, name="answer_relevancy", strictness=3)`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/collections/answer_relevancy/metric.py) | `user_input, response` | Judge 反推问题，再以 embedding 余弦相似度求均值；不承诺的回答乘以零 | 空文本抛错；没有生成问题时返回 `0.0`；没有 skip |
| [`FactualCorrectness(llm, mode="f1", beta=1.0, atomicity="low", coverage="low", name="factual_correctness")`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/collections/factual_correctness/metric.py) | `response, reference` | `mode` 为 `precision/recall/f1`；Judge 拆 claim 并做 NLI；结果四舍五入到两位 | 参数或 Judge 失败时抛错；没有 skip 与专用无分态 |
| [`Faithfulness(llm, name="faithfulness")`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/collections/faithfulness/metric.py) | `user_input, response, retrieved_contexts` | 回答 claim 被上下文支持的比例 | 无可判 claim 时为 `NaN`；其他故障抛错 |
| [`ContextEntityRecall(llm, name="context_entity_recall")`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/collections/context_entity_recall/metric.py) | `reference, retrieved_contexts` | 参照实体在检索上下文实体中的召回率 | 参照实体为空时因 epsilon 得 `0.0`；Judge 故障抛错 |
| [`ContextRecall(llm, name="context_recall")`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/collections/context_recall/metric.py) | `user_input, retrieved_contexts, reference` | 参照回答的 claim 可由上下文归因的比例 | 空输入抛错；Judge 没有给分类时为 `NaN` |
| [`ContextPrecisionWithReference(llm, name="context_precision_with_reference")`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/collections/context_precision/metric.py) | `user_input, reference, retrieved_contexts` | Judge 逐上下文判断有用性，再算 average precision | 空输入抛错；无正例为 `0.0`；没有 skip |
| `ContextPrecision(llm, **kwargs)` | 与上行相同 | 上行别名，默认 name 是 `context_precision` | 与上行相同 |
| [`ContextPrecisionWithoutReference(llm, name="context_precision_without_reference")`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/collections/context_precision/metric.py) | `user_input, response, retrieved_contexts` | 用回答代替 reference 判断上下文有用性 | 空输入抛错；无正例为 `0.0` |
| `ContextUtilization(llm, **kwargs)` | 与上行相同 | 上行别名，默认 name 是 `context_utilization` | 与上行相同 |
| [`ContextRelevance(llm, name="context_relevance", max_retries=5)`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/collections/context_relevance/metric.py) | `user_input, retrieved_contexts` | 两个 Judge 的上下文相关度合并 | 缺值或空 list 抛错；只有空白文本等特殊输入为 `0.0`；两个 Judge 都无有效值时为 `NaN` |
| [`NoiseSensitivity(llm, name="noise_sensitivity", mode="relevant")`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/collections/noise_sensitivity/metric.py) | `user_input, response, reference, retrieved_contexts` | `mode` 为 `relevant/irrelevant`；量化回答受对应上下文噪声影响，越低越好 | 输入或 Judge 失败时抛错；没有 skip |
| [`ResponseGroundedness(llm, name="response_groundedness", max_retries=5)`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/collections/response_groundedness/metric.py) | `response, retrieved_contexts` | 两个 Judge 的 groundedness 合并 | 缺值或空 list 抛错；空白文本为 `0.0`；两个 Judge 都无有效值时为 `NaN` |
| [`QuotedSpansAlignment(name="quoted_spans_alignment", casefold=True, min_span_words=3)`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/collections/quoted_spans/metric.py) | `response, retrieved_contexts` | 检查带引号片段是否来自上下文；无需模型 | 类型错误返回 `0.0` 与 reason；没有合格引文返回 `1.0` 与 reason |
| [`SummaryScore(llm, name="summary_score", length_penalty=True, coeff=0.5)`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/collections/summary_score/metric.py) | `reference_contexts, response` | 关键问题可答率与简洁度按 `coeff` 合并 | 空回答抛 `ValueError`；Judge 没生成答案列表时可触发除零错误；没有 skip |

`AnswerCorrectness.beta` 在固定构造器中要求实际类型为 `float`。
写 `beta=1` 会因类型检查失败，写 `beta=1.0` 才符合实现。

### 5.5 collections：确定性、字符串、embedding、多模态、SQL 与表格

| API 与构造参数 | `ascore` 参数 | 值、算法与依赖 | 失败、跳过与无分 |
| --- | --- | --- | --- |
| [`ExactMatch(name="exact_match")`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/collections/_string.py) | `reference, response` | Python 字符串全等：相等 `1.0`，否则 `0.0` | 没有归一化、reason 或 skip；非字符串也按 Python 相等比较 |
| [`StringPresence(name="string_present")`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/collections/_string.py) | `reference, response` | 大小写敏感的 `reference in response` | 非字符串触发 assertion；没有 skip |
| [`NonLLMStringSimilarity(name="non_llm_string_similarity", distance_measure=LEVENSHTEIN)`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/collections/_string.py) | `reference, response` | `1 - normalized_distance`；需 `rapidfuzz` | 依赖或类型不合规时抛错；没有 skip |
| `DistanceMeasure` | `LEVENSHTEIN`、`HAMMING`、`JARO`、`JARO_WINKLER` | 为上行选择算法的 enum，不是 Metric | 无求值入口 |
| [`BleuScore(name="bleu_score", kwargs=None)`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/collections/_bleu_score.py) | `reference, response` | SacreBLEU 除以 100；`kwargs` 传给 `corpus_bleu`；需 `sacrebleu` | 依赖缺失或非字符串时抛错；没有 skip |
| [`CHRFScore(name="chrf_score", kwargs=None)`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/collections/chrf_score/metric.py) | `reference, response` | SacreBLEU CHRF 除以 100；需 `sacrebleu` | 非字符串或空文本返回 `0.0` 与 reason；依赖缺失抛错 |
| [`RougeScore(name="rouge_score", rouge_type="rougeL", mode="fmeasure")`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/collections/_rouge_score.py) | `reference, response` | `rouge_type` 为 `rouge1/rougeL`；`mode` 为 `fmeasure/precision/recall`；需 `rouge_score` | 依赖或输入失败时抛错；没有 skip |
| [`SemanticSimilarity(embeddings, name="semantic_similarity", threshold=None)`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/collections/_semantic_similarity.py) | `reference, response` | embedding 余弦相似度；给 truthy threshold 后返回 `0.0/1.0` | provider 故障抛错；实现不夹紧余弦值；`threshold=0` 不会启用二值化 |
| [`MultiModalFaithfulness(llm, name="multi_modal_faithfulness")`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/collections/multi_modal_faithfulness/metric.py) | `response, retrieved_contexts` | 视觉能力 Judge 返回 `0.0/1.0` 与 reason | LLM 或输入失败时抛错；没有 skip |
| [`MultiModalRelevance(llm, name="multi_modal_relevance")`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/collections/multi_modal_relevance/metric.py) | `user_input, response, retrieved_contexts` | 视觉能力 Judge 返回 `0.0/1.0` 与 reason | LLM 或输入失败时抛错；没有 skip |
| [`DataCompyScore(mode="rows", metric="f1", name="data_compare_score")`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/collections/datacompy_score/metric.py) | `reference, response` | 两个参数都是 CSV 字符串；`mode` 为 `rows/columns`，聚合为 `precision/recall/f1`；需 `pandas`、`datacompy` | CSV 读取失败返回 `NaN` 与 reason；依赖缺失抛错 |
| [`SQLSemanticEquivalence(llm, name="sql_semantic_equivalence")`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/collections/sql_semantic_equivalence/metric.py) | `response, reference, reference_contexts=None` | Judge 判断两条 SQL 在可选 schema 上是否等价；返回 `0.0/1.0` 与 reason | Judge 或输入失败时抛错；不会执行 SQL；没有 skip |

安装 `ragas[all]==0.4.3` 会加入本表的可选算法依赖，也会加入许多与当前 Metric 无关的包。
生产项目更适合只安装实际使用的 `sacrebleu`、`rouge_score`、`rapidfuzz`、`pandas` 或 `datacompy`。

### 5.6 collections：rubric、Aspect Critic、Agent 与 tool Metric

| API 与构造参数 | `ascore` 参数 | 值、算法与依赖 | 失败、跳过与无分 |
| --- | --- | --- | --- |
| [`DomainSpecificRubrics(llm, rubrics=None, with_reference=False, name="domain_specific_rubrics")`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/collections/domain_specific_rubrics/metric.py) | `user_input=None, response=None, retrieved_contexts=None, reference_contexts=None, reference=None` | 一份 rubric 用于所有行；默认 `1..5`；返回分数与 feedback reason | Judge 故障抛错；构造器不会强制 `with_reference=True` 时必须传 reference |
| `RubricsScoreWithoutReference(llm, rubrics=None, name="rubrics_score_without_reference")` | 与上行相同 | `DomainSpecificRubrics(with_reference=False)` 的便利类 | 与上行相同 |
| `RubricsScoreWithReference(llm, rubrics=None, name="rubrics_score_with_reference")` | 与上行相同 | `DomainSpecificRubrics(with_reference=True)` 的便利类 | 与上行相同 |
| [`InstanceSpecificRubrics(llm, name="instance_specific_rubrics")`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/collections/instance_specific_rubrics/metric.py) | `rubrics, user_input=None, response=None, retrieved_contexts=None, reference_contexts=None, reference=None` | 每行传自己的 rubric；返回通常为 `1..5` 与 feedback reason | 空 rubric 抛 `ValueError`；Judge 故障抛错；没有 skip |
| [`AgentGoalAccuracyWithReference(llm, name="agent_goal_accuracy")`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/collections/agent_goal_accuracy/metric.py) | `user_input: list[Message], reference` | Judge 从工作流抽取结果并与参照目标比较；返回 `0.0/1.0` | 消息或 Judge 失败时抛错；没有 skip |
| `AgentGoalAccuracy(llm, name="agent_goal_accuracy")` | 与上行相同 | `AgentGoalAccuracyWithReference` 的别名 | 与上行相同 |
| [`AgentGoalAccuracyWithoutReference(llm, name="agent_goal_accuracy")`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/collections/agent_goal_accuracy/metric.py) | `user_input: list[Message]` | Judge 依据对话自身推断目标完成度；返回 `0.0/1.0` | 消息或 Judge 失败时抛错；没有 skip |
| [`ToolCallAccuracy(strict_order=True, name="tool_call_accuracy")`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/collections/tool_call_accuracy/metric.py) | `user_input: list[Message], reference_tool_calls: list[ToolCall]` | 无 LLM；严格模式比较次序、名字和全部 args；非严格模式先排序 | 两边都空为 `1.0`；只有一边空或实际调用数为零时为 `0.0`；没有 skip |
| [`ToolCallF1(name="tool_call_f1")`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/collections/tool_call_f1/metric.py) | 与上行相同 | 无 LLM；名字和完整嵌套 args 全等才算 true positive；集合比较忽略次序和重复项 | 两边都空时为 `0.0`；没有 reason、skip 或参数近似比较 |
| [`TopicAdherence(llm, mode="f1", name="topic_adherence")`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/metrics/collections/topic_adherence/metric.py) | `user_input: list[Message], reference_topics: list[str]` | Judge 抽取主题；`mode` 为 `precision/recall/f1` | 没抽到主题时为 `NaN`；Judge 故障抛错；没有 skip |

现代 collections 没有 `AspectCritic` 类。
[Aspect Critique 页面](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/aspect_critic/)
把这类自由准则 Judge 表达为 `DiscreteMetric`。
它的固定签名没有 `strictness` 或构造器 `llm` 参数；应把 LLM 传给 `score/ascore`。

### 5.7 所有 Metric 的共同失败语义

collections 没有统一的无分协议。
`NaN` 只出现在表格点名的若干内建算法；`MetricResult(value=None, reason=...)` 主要来自装饰器 Metric 的值校验。
普通异常、timeout 与 provider 错误不会自动转成 `MetricResult`。

`@experiment` 会捕获单行异常、打印 warning 并省略该行。
这不是 skip，因为结果中没有 skip 状态、输入 id、异常类型或标准 reason。
实验函数显式返回 `None` 时也会省略该行，并且同样不会写入状态。
CI 必须比较输入 id 集合与结果 id 集合，才能识别被省略的行。

legacy `evaluate(..., raise_exceptions=False)` 的行为不同：Executor 把每个失败 job 变成 `np.nan`，
并保留该行。`raise_exceptions=True` 会重新抛出异常。
两条路径都没有“因前置条件不适用而跳过”的专用状态。

### 5.8 legacy compatibility catalog

`ragas.metrics.__all__` 只公开协议、通用 Metric 与装饰器。
下表中的具体名字由模块 `__getattr__` 动态提供，每次 import 都发 `DeprecationWarning`，
并声称会在 v1.0 删除，见 R8。

所有类实例都通过 `single_turn_score/ascore` 或 `multi_turn_score/ascore` 求值并返回 `float`。
传入 `evaluate` 后，失败语义遵循上一节的 `raise_exceptions`。
小写名字是已经构造好的共享实例；它们没有独立的跳过态或 reason 返回值。

| legacy 名字，主要构造参数 | Sample 字段与返回 | collections 对应项或状态 |
| --- | --- | --- |
| `AnswerAccuracy(llm=None, name="nv_accuracy")` | `user_input,response,reference -> float` | `AnswerAccuracy`；默认 name 不同 |
| `AnswerCorrectness(llm=None, embeddings=None, weights=[0.75,0.25], beta=1.0, max_retries=1)`；`answer_correctness` | `user_input,response,reference -> float` | `AnswerCorrectness` |
| `AnswerRelevancy(llm=None, embeddings=None, strictness=3)`；`ResponseRelevancy`；`answer_relevancy` | `user_input,response -> float` | `AnswerRelevancy` |
| `AnswerSimilarity(embeddings=None, is_cross_encoder=False, threshold=None)`；`SemanticSimilarity`；`answer_similarity` | `response,reference -> float` | `SemanticSimilarity`；legacy 可选 cross encoder |
| `AspectCritic(name, definition, llm=None, required_columns=None, output_type=BINARY, single_turn_prompt=None, multi_turn_prompt=None, strictness=1, max_retries=1)` | 单轮可读全部主要字段；多轮读消息；返回 `0/1` | collections 无同名类；用 `DiscreteMetric` |
| `BleuScore(name="bleu_score", kwargs={})` | `response,reference -> float` | `BleuScore` |
| `ChrfScore(name="chrf_score", kwargs={})` | `response,reference -> float` | `CHRFScore`；大小写不同 |
| `ContextEntityRecall(llm=None, max_retries=1)`；`context_entity_recall` | `reference,retrieved_contexts -> float` | `ContextEntityRecall` |
| `ContextPrecision(llm=None, max_retries=1)`；`LLMContextPrecisionWithReference`；`context_precision` | `user_input,reference,retrieved_contexts -> float` | `ContextPrecisionWithReference` / `ContextPrecision` |
| `LLMContextPrecisionWithoutReference(llm=None, max_retries=1)`；`ContextUtilization` | `user_input,response,retrieved_contexts -> float` | `ContextPrecisionWithoutReference` / `ContextUtilization` |
| `IDBasedContextPrecision(name="id_based_context_precision")` | `retrieved_context_ids,reference_context_ids -> float` | collections 没有 ID 版本 |
| `NonLLMContextPrecisionWithReference(distance_measure=NonLLMStringSimilarity(), threshold=0.5)` | `retrieved_contexts,reference_contexts -> float` | collections 没有上下文列表的非 LLM 版本 |
| `ContextRecall(llm=None, max_retries=1)`；`LLMContextRecall`；`context_recall` | `user_input,reference,retrieved_contexts -> float` | `ContextRecall` |
| `IDBasedContextRecall(name="id_based_context_recall")` | `retrieved_context_ids,reference_context_ids -> float` | collections 没有 ID 版本 |
| `NonLLMContextRecall(_distance_measure=NonLLMStringSimilarity(), threshold=0.5)` | `retrieved_contexts,reference_contexts -> float` | collections 没有上下文列表的非 LLM 版本 |
| `ContextRelevance(llm=None, name="nv_context_relevance")` | `user_input,retrieved_contexts -> float` | `ContextRelevance`；默认 name 不同 |
| `DataCompyScore(mode="rows", metric="f1", name="data_compare_score")` | CSV `response,reference -> float` | `DataCompyScore` |
| `DistanceMeasure` | 四个字符串距离 enum 值 | `DistanceMeasure` |
| `ExactMatch(name="exact_match")` | `response,reference -> float` | `ExactMatch` |
| `FactualCorrectness(llm=None, mode="f1", beta=1.0, atomicity="low", coverage="low", language="english")` | `response,reference -> float` | `FactualCorrectness` |
| `Faithfulness(llm=None, max_retries=1)`；`faithfulness` | `user_input,response,retrieved_contexts -> float` | `Faithfulness` |
| `FaithfulnesswithHHEM(llm=None, max_retries=1, device="cpu", batch_size=10)` | 与 Faithfulness 相同；HHEM 分类器判 NLI | collections 无 HHEM 类；构造时加载 `vectara/hallucination_evaluation_model` |
| `InstanceRubrics(name="instance_rubrics", llm=None, required_columns=None, output_type=DISCRETE, single_turn_prompt=None, multi_turn_prompt=None, max_retries=1)` | `rubrics` 加单轮或多轮字段；返回 rubric 数字 | `InstanceSpecificRubrics` |
| `LLMSQLEquivalence(llm=None, name="llm_sql_equivalence_with_reference")` | `response,reference,reference_contexts -> 0/1` | `SQLSemanticEquivalence` |
| `MultiModalFaithfulness(llm=None, name="faithful_rate")`；`multimodal_faithness` | `response,retrieved_contexts -> float` | `MultiModalFaithfulness`；小写别名含官方拼写错误 |
| `MultiModalRelevance(llm=None, name="relevance_rate")`；`multimodal_relevance` | `user_input,response,retrieved_contexts -> float` | `MultiModalRelevance` |
| `NoiseSensitivity(llm=None, mode="relevant", max_retries=1)` | `user_input,response,reference,retrieved_contexts -> float` | `NoiseSensitivity` |
| `NonLLMStringSimilarity(distance_measure=LEVENSHTEIN)` | `response,reference -> float` | `NonLLMStringSimilarity` |
| `ResponseGroundedness(llm=None, name="nv_response_groundedness")` | `response,retrieved_contexts -> float` | `ResponseGroundedness`；默认 name 不同 |
| `RougeScore(rouge_type="rougeL", mode="fmeasure")` | `response,reference -> float` | `RougeScore` |
| `RubricsScore(name="domain_specific_rubrics", rubrics=默认五级, llm=None, required_columns=None, output_type=DISCRETE, single_turn_prompt=None, multi_turn_prompt=None, max_retries=1)` | 单轮或多轮字段；返回 rubric 数字 | `DomainSpecificRubrics` |
| `SimpleCriteriaScore(name, definition, llm=None, required_columns=None, output_type=DISCRETE, single_turn_prompt=None, multi_turn_prompt=None, strictness=1)` | 单轮或多轮字段；返回 Judge 数字 | collections 无同名类；用 `DiscreteMetric` 或 `NumericMetric` |
| `StringPresence(name="string_present")` | `response,reference -> float` | `StringPresence` |
| `SummarizationScore(llm=None, max_retries=1, length_penalty=True, coeff=0.5)`；`summarization_score` | `response,reference_contexts -> float` | `SummaryScore` |
| `ToolCallAccuracy(strict_order=True, arg_comparison_metric=ExactMatch())` | 多轮消息与 `reference_tool_calls -> float` | `ToolCallAccuracy`；collections 取消可替换参数比较 Metric |
| `ToolCallF1(batch_size=1, is_multi_turn=True)` | 多轮消息与 `reference_tool_calls -> float` | `ToolCallF1` |
| `TopicAdherenceScore(llm=None, mode="f1")` | 多轮消息与 `reference_topics -> float` | `TopicAdherence` |
| `AgentGoalAccuracyWithReference(llm=None, max_retries=1)` | 多轮消息与 `reference -> 0/1` | `AgentGoalAccuracyWithReference` / `AgentGoalAccuracy` |
| `AgentGoalAccuracyWithoutReference(llm=None, max_retries=1)` | 多轮消息 `-> 0/1` | `AgentGoalAccuracyWithoutReference` |

legacy `MetricWithLLM` 还提供下列训练入口，见 R8：

```python
train(
    path,
    demonstration_config=None,
    instruction_config=None,
    callbacks=None,
    run_config=None,
    batch_size=None,
    with_debugging_logs=False,
    raise_exceptions=True,
)
```

prompt 管理方法是 `get_prompts()`、`set_prompts()`、`adapt_prompts()`、
`save_prompts()` 与 `load_prompts()`。
这些方法操作 legacy PydanticPrompt，不适用于 collections 的函数式 prompt。

## 6. 可直接复制的完整场景

### 6.1 确定性检查、组合分数、聚合与 CI 条件

这个场景使用官方 quickstart 的 `Dataset -> @experiment -> MetricResult -> Experiment` 形状，
但选择 JSONL，并显式检查缺行。它不调用外部模型。

```python
import asyncio
from statistics import fmean

from ragas import Dataset, experiment
from ragas.metrics.collections import ExactMatch, StringPresence


exact = ExactMatch()
contains = StringPresence()


@experiment()
async def run_eval(row: dict) -> dict:
    exact_result = await exact.ascore(
        reference=row["reference"],
        response=row["response"],
    )
    presence_result = await contains.ascore(
        reference=row["must_contain"],
        response=row["response"],
    )
    combined = 0.5 * exact_result.value + 0.5 * presence_result.value
    return {
        **row,
        "exact_match": exact_result.value,
        "string_presence": presence_result.value,
        "combined": combined,
        "passed": combined >= 0.5,
    }


async def main() -> None:
    dataset = Dataset(
        name="answers",
        backend="local/jsonl",
        root_dir=".",
        data=[
            {
                "id": "q1",
                "response": "Paris",
                "reference": "Paris",
                "must_contain": "Paris",
            },
            {
                "id": "q2",
                "response": "The answer is 4.",
                "reference": "4",
                "must_contain": "4",
            },
        ],
    )
    dataset.save()

    result = await run_eval.arun(dataset, name="deterministic-v1")
    rows = sorted(list(result), key=lambda row: row["id"])

    expected_ids = {row["id"] for row in dataset}
    result_ids = {row["id"] for row in rows}
    if result_ids != expected_ids:
        raise SystemExit(f"missing rows: {sorted(expected_ids - result_ids)}")

    mean_score = fmean(row["combined"] for row in rows)
    print([(row["id"], row["combined"], row["passed"]) for row in rows])
    print("mean", mean_score)

    if not all(row["passed"] for row in rows):
        raise SystemExit(1)


asyncio.run(main())
```

输出是：

```text
[('q1', 1.0, True), ('q2', 0.5, True)]
mean 0.75
```

该组合分数和 `0.5` 条件都是示例项目自己的政策，不是 Ragas 默认值。
结果保存在 `experiments/deterministic-v1.jsonl`。

### 6.2 开放准则 Judge

下例以任意准确性准则创建 `DiscreteMetric`。
`AsyncOpenAI()` 从进程变量读取密钥；实际项目应通过 CI secret 注入。
构造器不接收 `llm`，每次求值时把 `llm` 传给 `ascore()`。

```python
import asyncio

from openai import AsyncOpenAI

from ragas.llms import llm_factory
from ragas.metrics import DiscreteMetric


async def main() -> None:
    client = AsyncOpenAI()
    llm = llm_factory(
        "gpt-4o-mini",
        client=client,
        temperature=0,
    )
    judge = DiscreteMetric(
        name="answer_supported",
        allowed_values=["pass", "fail"],
        prompt="""Decide whether the response is fully supported by the reference.

Reference: {reference}
Response: {response}

Return pass only when every factual claim is supported; otherwise return fail.
""",
    )

    result = await judge.ascore(
        llm=llm,
        reference="Paris is the capital of France.",
        response="Paris is the capital of France.",
    )
    if result.value is None:
        raise RuntimeError(result.reason)

    print(result.value)
    print(result.reason)
    print(result.traces)


asyncio.run(main())
```

值只能是 `pass` 或 `fail`，reason 由 Judge 生成。
结构化请求的输入和输出放在 `MetricResult.traces`。
即使温度为零，模型版本、provider 与服务端变化仍可能改变结果；CI 应固定模型名并保存 reason。

### 6.3 多轮 Agent 与 tool call

这个场景构造合法的 `MultiTurnSample`，再运行两个无需 LLM 的 tool Metric。
它同时展示消息和参照 tool call 的完整形状。

```python
import asyncio

from ragas.dataset_schema import MultiTurnSample
from ragas.messages import AIMessage, HumanMessage, ToolCall, ToolMessage
from ragas.metrics.collections import ToolCallAccuracy, ToolCallF1


async def main() -> None:
    expected_calls = [
        ToolCall(name="weather", args={"city": "Paris"}),
    ]
    sample = MultiTurnSample(
        user_input=[
            HumanMessage(content="What is the weather in Paris?"),
            AIMessage(content="", tool_calls=expected_calls),
            ToolMessage(content="18 C and sunny"),
            AIMessage(content="It is 18 C and sunny."),
        ],
        reference="Tell the user the Paris weather.",
        reference_tool_calls=expected_calls,
        reference_topics=["weather"],
    )

    accuracy = await ToolCallAccuracy(strict_order=True).ascore(
        user_input=sample.user_input,
        reference_tool_calls=sample.reference_tool_calls,
    )
    f1 = await ToolCallF1().ascore(
        user_input=sample.user_input,
        reference_tool_calls=sample.reference_tool_calls,
    )
    print(accuracy.value, f1.value)


asyncio.run(main())
```

输出是 `1.0 1.0`。
若还要判断最终目标，可把同一消息列表交给 `AgentGoalAccuracy` 并提供 LLM；
若要判断话题，可交给 `TopicAdherence` 与 `reference_topics`。

### 6.4 legacy `evaluate`、typed dataset 与 `RunConfig`

此例用于维护仍依赖 `evaluate` 的代码。它故意使用 legacy `ExactMatch`，
因为同名的 collections 类不会通过 `evaluate` 的类型检查。

```python
import warnings

warnings.simplefilter("ignore", DeprecationWarning)

from ragas import evaluate
from ragas.dataset_schema import EvaluationDataset, SingleTurnSample
from ragas.metrics import ExactMatch
from ragas.run_config import RunConfig


dataset = EvaluationDataset(
    samples=[
        SingleTurnSample(response="Paris", reference="Paris"),
        SingleTurnSample(response="Lyon", reference="Paris"),
    ]
)

result = evaluate(
    dataset,
    metrics=[ExactMatch()],
    run_config=RunConfig(
        timeout=30,
        max_retries=2,
        max_workers=2,
    ),
    raise_exceptions=True,
    show_progress=False,
)

print(result)
print(result["exact_match"])
```

输出是：

```text
{'exact_match': 0.5000}
[1.0, 0.0]
```

新代码不应仅为得到均值而选择这条 deprecated 路径。
collections 结果可用 `statistics.fmean`、NumPy、Pandas 或项目自己的统计函数聚合。

## 7. 结果、诊断、artifact、CI 与 regrade

### 7.1 collections 结果

单次结果由 `MetricResult` 承载。内建 Metric 只有部分会写 reason；
通用 LLM Metric 会把格式化后的输入和结构化输出放进 traces。
这些 traces 没有 token、费用、耗时、模型 revision 或 artifact URI 的标准字段，见 R2 与 R3。

批量结果由实验函数的返回行决定。
推荐每行至少保留：

```text
id
原始输入
应用 response 或 messages
每个 metric 的 value
每个 metric 的 reason
模型与 prompt revision
应用 trace URI
artifact URI 或相对路径
项目自己的 passed / error 字段
```

Ragas 不复制 artifact，也不验证 URI。
这些列只是 Experiment 中的普通数据。
含嵌套 metadata 时使用 `local/jsonl`，避免 CSV 把 list 与 dict 变成难以可靠读取的字符串。

### 7.2 legacy `EvaluationResult`

[`EvaluationResult`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/dataset_schema.py#L412-L541)
提供以下公开读法：

| API | 返回与默认行为 |
| --- | --- |
| `result.scores` | `list[dict[str, Any]]`，每行一个 Metric 值 |
| `result[metric_name]` | 该 Metric 的逐行值列表 |
| `repr(result)` | 每列 `safe_nanmean`，忽略部分 `NaN`；整列全是 `NaN` 时仍显示 `NaN` |
| `result.to_pandas(batch_size=None, batched=False)` | 原 Dataset 与分数列拼接；需要 pandas；两个参数在固定实现中没有改变转换逻辑 |
| `result.traces` | 由 callback run tree 转换的 trace 列表 |
| `result.total_tokens()` | 只有传 `token_usage_parser` 后可用，否则抛 `ValueError` |
| `result.total_cost(...)` | 同上；可传统一单价或 `per_model_costs` |

`EvaluationResult` 没有总分、阈值或统一通过态。
均值只用于 `repr`；它不会自动使命令以非零状态退出。

### 7.3 诊断与失败完整性

collections 内建 Judge 往往只返回数值，rubric、SQL、多模态与通用 Judge 才稳定提供 reason。
provider exception 仍是 Python 异常。
`@experiment` 的 warning 是控制台文字，不会自动成为结果列。

因此实验函数应自己捕获可恢复错误，并返回具名字段；不可恢复错误应在 `.arun()` 后通过 id 完整性检查升级为 CI 失败。
不要只计算剩余行的均值，否则被省略的困难样本会让读数虚高。

legacy 路径可用 `callbacks` 收集 LangChain 生命周期信息，也可读 `EvaluationResult.traces`。
`raise_exceptions=False` 只保存 `NaN`，不会在分数单元格内保存异常类型和消息；需要诊断时应配置日志或 callback。

### 7.4 CI

Ragas 没有针对 collections 的内建 CI 判定命令。
第 6.1 节展示了可靠的最小做法：先核对输入和结果 id，再检查每行条件，最后用 `SystemExit(1)` 失败。
还应明确拒绝 `None`、`NaN` 与未知离散值。

一个数值判定函数可以写成：

```python
import math


def require_score(value: float | None, minimum: float) -> bool:
    return value is not None and math.isfinite(value) and value >= minimum
```

阈值、权重、允许缺分比例和最低样本数都属于项目政策。
不要把 `MetricResult.allowed_values` 或 legacy `MetricOutputType` 当作 CI 判定；它们不产生 pass/fail。

### 7.5 regrade

Ragas 没有“从旧运行只重算 Metric”的专用命令。
现代做法是用 `Experiment.load(name, backend, ...)` 读取已有 response、messages、contexts 和参照字段，
再把这些行交给一个只调用新 Metric 的第二个 `@experiment`。

第二次实验应使用新名字，并复制原始 `id`、应用 revision 与旧实验名。
这样能区分“应用重新运行”和“只更换 Judge 或 Metric”。
若旧结果缺少新 Metric 的输入字段，就无法可靠再次求值。

legacy `EvaluationResult` 也没有 regrade API。
可从 `result.to_pandas()` 或原 `EvaluationDataset` 构造另一次 `evaluate`，但需要调用者自己关联两次结果。

### 7.6 Git 版本函数

[`version_experiment(experiment_name, commit_message=None, repo_path=None, create_branch=True, stage_all=False) -> str`](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/src/ragas/experiment.py#L21-L101)
需要 `ragas[git]`。
它会暂存已跟踪文件的变化、创建 commit，并在默认配置下创建 `ragas/<experiment_name>` 分支。
`stage_all=True` 还会暂存未跟踪文件。

这不是只读的 provenance 查询。
共享仓库或 CI 不应把它当作自动 metadata 采集函数；更安全的做法是由调用者读取 commit hash，再作为普通列写入 Experiment。

## 8. 自定义扩展

### 8.1 确定性装饰器 Metric

下面的自定义 Metric 会计算参照 token 的召回率。
装饰器从函数类型注解生成 Pydantic 输入校验，并把返回值限制在 `0..1`。

```python
from ragas.metrics import MetricResult, numeric_metric


@numeric_metric(name="token_recall", allowed_values=(0.0, 1.0))
def token_recall(reference: str, response: str) -> MetricResult:
    expected = set(reference.casefold().split())
    actual = set(response.casefold().split())
    matched = expected & actual
    value = len(matched) / len(expected) if expected else 1.0
    return MetricResult(
        value=value,
        reason=f"matched {len(matched)}/{len(expected)}",
    )


result = token_recall.score(
    reference="paris france",
    response="Paris",
)
print(result.value)
print(result.reason)
```

输出：

```text
0.5
matched 1/2
```

把返回值改成 `1.5` 不会抛异常，而会得到 `MetricResult(value=None, reason=...)`。
函数自身抛错也会变成同样的 `None + reason` 形状。

### 8.2 自定义开放 Judge

自由准则可直接使用 `DiscreteMetric`、`NumericMetric` 或 `RankingMetric`。
prompt 中的 `{field}` 决定求值时要传哪些关键字。
这三个类通过 LLM 的 Pydantic response model要求 value 和 reason，因此不用自己读取纯文本回答。

若要保存 Judge 定义，可调用 `metric.save("quality.json")`，再用对应类的 `load()` 读取。
若 prompt 使用动态 few-shot embedding，`load()` 还要传 `embedding_model`，见 R3。

### 8.3 collections 子类

需要多步算法时，继承 collections 的 `BaseMetric`，在构造器中调用 `super().__init__()`，
并实现 async `ascore()`：

```python
from ragas.metrics import MetricResult
from ragas.metrics.collections import BaseMetric


class LengthRatio(BaseMetric):
    def __init__(self, name: str = "length_ratio") -> None:
        super().__init__(name=name, allowed_values=(0.0, 1.0))

    async def ascore(self, reference: str, response: str) -> MetricResult:
        if not reference:
            return MetricResult(value=None, reason="reference is empty")
        ratio = min(len(response) / len(reference), 1.0)
        return MetricResult(value=ratio)
```

`BaseMetric.allowed_values` 不会替子类自动校验返回值。
子类要像上例一样自己决定空输入、异常与无分行为。
该类可用于 `@experiment`，但不能传给 legacy `evaluate`。

### 8.4 legacy 自定义 Metric

维护旧调用链时，可实现 `SingleTurnMetric`：

```python
from dataclasses import dataclass, field

from ragas.dataset_schema import SingleTurnSample
from ragas.metrics import MetricType, SingleTurnMetric
from ragas.run_config import RunConfig


@dataclass
class StartsWith(SingleTurnMetric):
    _required_columns: dict = field(
        default_factory=lambda: {
            MetricType.SINGLE_TURN: {"response", "reference"},
        }
    )
    name: str = "starts_with"

    def init(self, run_config: RunConfig) -> None:
        pass

    async def _single_turn_ascore(
        self,
        sample: SingleTurnSample,
        callbacks,
    ) -> float:
        response = sample.response or ""
        reference = sample.reference or ""
        return float(response.startswith(reference))
```

多轮类改为继承 `MultiTurnMetric`，并实现 `_multi_turn_ascore()`。
若依赖 LLM 或 embedding，还要组合 `MetricWithLLM` 或 `MetricWithEmbeddings`，
并让 `init(run_config)` 检查依赖。

### 8.5 backend 扩展

需要新的结果保存介质时，可继承 R5 的 `BaseBackend`，实现 dataset 与 experiment 的
`load`、`save`、`list` 方法，再通过 `ragas.backends` entry point 注册。
这个扩展面只负责行数据的持久化，不定义 Metric、聚合或 CI 条件。

## 9. 好在哪里

本节是研究判断。

1. collections 的关键字输入很直接。`Faithfulness.ascore(user_input=..., response=..., retrieved_contexts=...)`
   让作者在调用点就看到所需证据，不必先学习统一而庞大的 test case。
2. `MetricResult(value, reason, traces)` 足够轻。确定性算法只返回值，Judge 可以追加理由，
   自定义代码也能沿用相同形状。
3. `@experiment` 不限制行 schema。作者能把应用回答、Metric 值、reason、模型 revision、trace URI
   和业务切片字段放在同一行，随后用常规 Python 数据工具分析。
4. 确定性 Metric 与 Judge Metric 使用同一调用协议。组合 `ExactMatch`、`ToolCallAccuracy` 与 rubric
   时不需要另一套 runner。
5. rubric 分为全数据共用和逐行传入。`DomainSpecificRubrics` 与 `InstanceSpecificRubrics`
   让准则的所有权在构造点就可见。
6. Agent 面没有假装执行工具。`ToolCallAccuracy` 与 `ToolCallF1` 明确接受消息和参照 tool call，
   适合对已存在的 transcript 做确定性检查。
7. JSONL backend 保留嵌套类型。对消息、reason 与 artifact metadata 来说，这比只提供 CSV 更实用。
8. 装饰器 Metric 会从函数签名生成输入校验，并把异常与越界值写成 `None + reason`。
   对轻量业务算法，这是很短的扩展路径。

## 10. 不好的地方与不应类比 NiceEval 的边界

本节是研究判断。

### 10.1 作者体验问题

1. 两套 Metric 继承树使用相似名字，却不能互换。
   `collections.ExactMatch()` 不能进入 `evaluate()`，错误消息还建议使用 `AspectCritic()`，
   但 collections 根本没有这个类。
2. `evaluate` 和 `aevaluate` 已 deprecated，官网若干页面却仍把它们当主入口。
   新作者很容易从旧页面学到 Sample 协议，再从新页面复制 collections import。
3. `@experiment` 吞掉单行异常并省略行。
   没有 id 完整性检查时，批次可以在少算样本后继续成功。
4. 内建 Metric 的失败形状不统一。
   有的抛错，有的给 `NaN`，有的给 `0`，有的才附 reason；没有标准 skip 或 unavailable。
5. 现代路径没有 `RunConfig`、统一并发上限、retry 或 timeout。
   LLM 工厂、个别 Metric、asyncio 与应用端各自拥有一部分运行参数。
6. `MetricResult` 没有阈值、通过态、严重度或标准诊断字段。
   Experiment 也没有内建聚合与 CI 退出政策。
7. `local/csv` 会把嵌套值变成字符串，Experiment 的完成次序又不稳定。
   默认入门示例没有提醒作者保留 id 并重新对齐。
8. 包对 LangChain 依赖没有有效上限，观察日的新安装会在 import 阶段失败。
   这使一个无需 LLM 的 `ExactMatch` 也受 VertexAI 兼容问题影响。
9. `version_experiment()` 会改变 Git 索引、commit 和分支。
   函数名没有充分传达这些写操作，对共享仓库风险很高。

### 10.2 不应类比 NiceEval

| Ragas 对象或行为 | 不能据此推定的 NiceEval 语义 |
| --- | --- |
| `Dataset` 的一行 | 不是 Run、attempt、turn、事件流或 Sandbox 生命周期 |
| `Experiment` | 是结果行表，不是负责实验矩阵、资源和执行策略的调度实体 |
| `MetricResult.reason` | 是可选 Judge 理由，不等于结构化 assertion evidence 或 artifact |
| `NaN` | 只是若干算法和 legacy 失败的数值表示，不等于 skip、unavailable 或 errored Verdict |
| `ToolCallAccuracy` | 只比较声明的消息，不证明工具执行成功、参数生效或副作用正确 |
| `RunConfig` | 只管理 legacy Metric 任务的部分超时、重试与并发，不管理被测进程或 Sandbox |
| `safe_nanmean` | 只是展示每列均值，不是 NiceEval 的 Verdict 折叠或计分政策 |
| `@experiment` 单行异常 | 被省略的行没有稳定状态，不能类比为 NiceEval 的跳过或失败 Sample |
| `MetricResult.traces` | 只有 `input/output` 两个可选槽位，不是完整调用 trace 或可导航协议历史 |

## 11. 对 NiceEval 可吸收与不应复制

本节是研究判断，不改写 NiceEval 的既定契约。

### 可吸收

| Ragas 细节 | 对 NiceEval 的启发 |
| --- | --- |
| `ascore(**named_fields)` | 面向常见事实提供具名参数，让调用点自描述；复杂生命周期仍由 NiceEval 自己的对象承载 |
| `MetricResult.value + reason` | 自定义 evaluator 的最小返回形状可同时方便机器聚合与人工诊断 |
| 全局 rubric 与逐行 rubric 分离 | 准则所有权应在定义点明确，避免同一字段既像配置又像样本输入 |
| Experiment 返回行保留原输入 | 报告中的判分值应能就近关联输入、回答、模型与应用 revision |
| JSONL 保留嵌套值 | 中间交换格式应保留消息、tool call 和诊断结构，不依赖 CSV 字符串往返 |
| collections 构造时拒绝 legacy wrapper | 跨代协议应尽早给出具名错误，不把不兼容拖到求值中段 |
| 确定性与 Judge 使用同一 per-item 调用形状 | 组合层可统一处理不同 evaluator，但仍要保留各自的失败与成本信息 |

### 不应复制

| Ragas 取舍 | NiceEval 不应复制的原因 |
| --- | --- |
| 两套同名 Metric 协议长期并存 | import 成功不代表 runner 接受，错误到运行时才出现 |
| 单行异常只打印并省略 | 丢失 Sample 身份、错误类型与可审计状态，聚合会偏向成功行 |
| 用 `NaN` 同时表示算法无值和执行失败 | 无法区分不适用、Judge 空输出、timeout 与程序错误 |
| 没有一等阈值与 Verdict | 调用者各自发明 CI 政策，报告与退出状态容易不一致 |
| 按完成先后保存而不带自动序号 | 输入与结果需要额外连接，缺行也更难发现 |
| 由结果工具自动暂存和 commit Git | 越过实验 metadata 的职责边界，也可能纳入无关变化 |
| 不约束关键传递依赖版本 | 确定性 API 也会因无关 provider import 而不可用 |
| `MetricResult.to_dict()` 丢掉 traces | 序列化形状与内存形状不同，诊断会在保存边界静默消失 |

## 12. 无法核实项

以下项目无法从 `0.4.3` 的固定源码、官方文档与发布元数据得到一致答案。
它们不应被当成稳定 API 承诺。

1. 官方尚未发布解决 VertexAI import 的版本，也没有维护者确认的依赖约束。
   `langchain-community==0.3.31` 是本文探测可用、且官方 issue 中也有人成功使用的临时办法，
   不是 Ragas release metadata 给出的正式组合。
2. [Aspect Critique 文档](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/aspect_critic/)
   有示例把 `llm` 传入 `DiscreteMetric` 构造器，并宣称存在 `strictness`。
   固定签名都没有这两个构造参数；固定实现要求 `ascore(llm=...)`。
3. legacy `AspectCritic` 与 `SimpleCriteriaScore` 保存 `strictness`，并把偶数加一。
   但固定 `_ascore` 每次只请求一个 Judge 输出，再把单元素列表交给多数函数。
   因此源码无法证明 `strictness>1` 会产生多次调用。
4. [CI 页面](https://docs.ragas.io/en/stable/howtos/applications/add_to_ci/)
   展示 `evaluate(..., in_ci=True)`。
   固定 `evaluate` 与 `aevaluate` 均无 `in_ci` 参数，源码也没有该分支。
5. [`ToolCallF1` 文档](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/agents/)
   的“两次正确、一次额外调用”示例给出 `0.67`。
   固定实现按标准 F1 计算为 `0.8`，无法确认网页数字对应哪一版算法。
6. 0.3 到 0.4 的迁移页说多模态 Metric 尚未迁入 collections。
   `0.4.3` 固定导出和源码却包含 `MultiModalFaithfulness` 与 `MultiModalRelevance`。
7. `DiscreteMetric`、`NumericMetric`、`RankingMetric` 的 `align()`、`align_and_validate()`、
   `validate_alignment()` 是公开方法，但 stable 文档没有完整参数、数据列契约或成熟度说明。
8. 官网没有规定所有 LLM Metric 的可比模型 revision、重复次数或统计误差。
   不同 provider 和模型之间的分数可交换性无法仅靠 API reference 核实。
9. 官网没有定义 collections 的标准 regrade、整体通过态、缺分政策或 artifact schema。
   本文给出的二次 Experiment 与 CI 检查是研究建议，不是官方命令。
10. `SemanticSimilarity` 文档常把结果写成 `0..1`，固定实现直接返回余弦相似度且不夹紧。
    对会产生负余弦值的 embedding，是否应由调用者截断，官方材料没有一致说明。
11. [`0.4.3` README 示例](https://github.com/vibrantlabsai/ragas/blob/4ecab384fda829ca50bec3f07cc49589d756e172/README.md)
    从 collections 导入不存在的 `AspectCritic`，还省略 `llm_factory()` 必需的 client。
    该示例无法作为固定版本的可运行契约。
