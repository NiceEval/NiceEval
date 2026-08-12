# Pydantic Evals 断言、判分与聚合作者面

观察日期：2026-08-09。

本文研究 Pydantic Evals 的公开作者面。
事实以 `pydantic-evals 2.27.0` 和对应仓库 commit 为准。
滚动文档用于理解推荐路径，固定源码用于裁定签名、默认值和边界。

## 1. 定位与真实边界

**官方事实。**
Pydantic Evals 是 Python code-first 评估框架。
它把任意同步或异步函数当作 Task，不要求 Task 使用 Pydantic AI。
作者用 `Dataset`、`Case`、`Evaluator` 和 `ReportEvaluator` 声明输入、期望输出、单 case 判分与整份报告分析。
[官方总览](https://pydantic.dev/docs/ai/evals/evals/)明确把结果对象、终端报告和可选 Logfire 查看面分开。

它的核心边界如下。

| 能力 | Pydantic Evals 负责什么 | 不负责什么 |
|---|---|---|
| case 执行 | 把每个 `Case.inputs` 交给同一 Task，可并发、重复和重试 | 不提供 Agent Sandbox 或 Fixture |
| 单 case 判分 | evaluator 读取 typed context，返回 assertion、score 或 label | score 没有内建 threshold，也不会自动使进程失败 |
| 行为判定 | `HasMatchingSpan` 与 agentic evaluator 查询本次 Task 的 span tree | 看不到没有本地 span 的 provider-native 工具 |
| 整体分析 | report evaluator 读取全部成功 case，产生矩阵、曲线、数值或表格 | analysis 不是 CI gate |
| 展示 | `EvaluationReport` 可打印、渲染、比较和编码成 JSON | 没有独立 eval CLI，也没有内建静态报告站 |
| 再次判分 | `run_evaluators()` 可对一个已重建的 `EvaluatorContext` 再跑 evaluator | 没有从一个 JSON report 完整重建 span context 的官方实现 |
| online eval | 装饰函数后在后台抽样执行同一种 `Evaluator` | 默认结果走 OTel event；它不是离线 Dataset 的替代品 |

**研究判断。**
它首先是 typed scorer framework，不是 Jest 风格断言 DSL。
布尔值、数字和字符串靠返回类型分流，调用点没有 matcher handle、严重度或控制流操作。
这使 Python 扩展很直接，也使“得到一个分数”和“阻止合并”之间留给作者自行接线。

Pydantic Evals 也不是 NiceEval 的 Run Assertion 替身。
它没有 run、session、turn 或 Sandbox receiver，没有题内 points、Severity、证据完整度和 `unavailable`。
span evaluator 能查看 OTel 事实，但不提供 NiceEval 那种事件与文件证据 locator。

## 2. 观察版本和一手链接

PyPI 在 2026-08-08 发布 `2.27.0`。
该 release 的 tag 指向 commit `f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc`。
包要求 Python 3.10 或更高版本。

| 编号 | 固定材料 | 本文用它核实什么 |
|---|---|---|
| V1 | [GitHub release v2.27.0](https://github.com/pydantic/pydantic-ai/releases/tag/v2.27.0) | tag、发布日期与 release 边界 |
| V2 | [PyPI 2.27.0](https://pypi.org/project/pydantic-evals/2.27.0/) | 包版本、Python 要求与发布文件 |
| V3 | [固定 pyproject](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pyproject.toml) | 依赖、extra 与稳定分类 |
| D1 | [Quick Start](https://pydantic.dev/docs/ai/evals/getting-started/quick-start/) 与 [Core Concepts](https://pydantic.dev/docs/ai/evals/getting-started/core-concepts/) | 新手路径、对象关系与完整示例 |
| D2 | [固定 dataset.py](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/dataset.py) 与 [Dataset API](https://pydantic.dev/docs/ai/api/pydantic_evals/dataset/) | `Case`、`Dataset`、evaluate、序列化和执行语义 |
| E1 | [固定 evaluator.py](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/evaluators/evaluator.py)、[context.py](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/evaluators/context.py) 与 [执行适配](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/evaluators/_run_evaluator.py) | context、合法返回、失败和命名 |
| E2 | [固定 common.py](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/evaluators/common.py) 与 [Built-in Evaluators](https://pydantic.dev/docs/ai/evals/evaluators/built-in/) | 比较、Judge、G-Eval 和通用 span evaluator |
| E3 | [固定 agentic.py](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/evaluators/agentic.py) 与 [Agentic Evaluators](https://pydantic.dev/docs/ai/evals/evaluators/agentic/) | 工具、轨迹、参数和预算 evaluator |
| J1 | [固定 llm_as_a_judge.py](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/evaluators/llm_as_a_judge.py) 与 [LLM Judge 指南](https://pydantic.dev/docs/ai/evals/evaluators/llm-judge/) | 默认裁判模型、prompt 路由与低层函数 |
| S1 | [固定 span_tree.py](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/otel/span_tree.py) 与 [Span-Based 指南](https://pydantic.dev/docs/ai/evals/evaluators/span-based/) | `SpanQuery`、遍历和缺 span 行为 |
| R1 | [固定 report evaluator](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/evaluators/report_common.py)、[reporting](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/reporting/__init__.py) 与 [指南](https://pydantic.dev/docs/ai/evals/evaluators/report-evaluators/) | 聚合算法、analysis 形状与报告 API |
| O1 | [固定 online.py](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/online.py)、[实现文件](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/_online.py)与 [Online Evaluation](https://pydantic.dev/docs/ai/evals/online-evaluation/) | online evaluator、抽样、发布依赖缺口和低层再次判分 |

PyPI wheel 的 SHA-256 是 `e97ee1128b50a4296c557a80bb3f0a5f5bdf6e16576ee7a2822d7fc3d28d6e03`。
sdist 的 SHA-256 是 `dc0ea51e921a50b9d20bc7e99ac437de97d30a4a02a7d38a658b6edfe09cf19c`。
两项都可在 [PyPI JSON 元数据](https://pypi.org/pypi/pydantic-evals/2.27.0/json)复核。

滚动文档与固定源码有几处冲突。
本文采用固定源码，因为它与已发布 wheel 对应。
冲突会在相关 API 和第 12 节明示，不把指南注释当作运行时保证。

## 3. 安装、最小项目和首个可运行 eval

最小确定性用法只需 `pydantic-evals`。
Judge、span 与 retry 需要额外依赖。
[安装页](https://pydantic.dev/docs/ai/overview/install/)列出了 slim extra。

| 目标 | 固定安装命令 |
|---|---|
| 确定性 eval | `uv add "pydantic-evals==2.27.0"` |
| OpenAI Judge | `uv add "pydantic-evals==2.27.0" "pydantic-ai-slim[openai]==2.27.0"` |
| span evaluator | `uv add "pydantic-evals[logfire]==2.27.0"` |
| evaluator retry | `uv add "pydantic-evals==2.27.0" "pydantic-ai-slim[retries]==2.27.0"` |
| 2.27.0 online evaluator | `uv add "pydantic-evals==2.27.0" "sniffio==1.3.1"` |

基础包会固定安装同版本的 `pydantic-ai-slim`，但不会安装 OpenAI、Anthropic 或 Google client。
`LLMJudge` 使用字符串 model ID 时，还要安装对应 provider extra。

一个最小目录只有两个文件。

```text
pydantic-evals-demo/
├── pyproject.toml
└── eval_uppercase.py
```

`pyproject.toml`：

```toml
[project]
name = "pydantic-evals-demo"
version = "0.1.0"
requires-python = ">=3.10"
dependencies = ["pydantic-evals==2.27.0"]
```

`eval_uppercase.py` 采用官方 Quick Start 的完整形状：

```python
from pydantic_evals import Case, Dataset
from pydantic_evals.evaluators import Contains, EqualsExpected


dataset = Dataset[str, str, None](
    name='uppercase_tests',
    cases=[
        Case(
            name='uppercase_basic',
            inputs='hello world',
            expected_output='HELLO WORLD',
        ),
        Case(
            name='uppercase_with_numbers',
            inputs='hello 123',
            expected_output='HELLO 123',
        ),
    ],
    evaluators=[
        EqualsExpected(),
        Contains(value='HELLO', case_sensitive=True),
    ],
)


def uppercase_text(text: str) -> str:
    return text.upper()


report = dataset.evaluate_sync(uppercase_text, progress=False)
report.print(include_input=True, include_output=True, include_durations=False)
```

执行：

```bash
uv sync
uv run python eval_uppercase.py
```

两个 evaluator 都返回布尔 assertion。
终端表会为每个 case 显示两个判定，并在 Averages 行显示总体 assertion pass rate。
`report.print()` 只展示报告；它不会根据叉号改变进程退出码。

## 4. 核心数据流与对象关系

下面的关系来自 [Dataset 执行源码](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/dataset.py#L281-L473)。

```text
Dataset
├── cases: Case[]
├── evaluators: Evaluator[] ─────────────┐
└── report_evaluators: ReportEvaluator[] │
                                         │
Case.inputs ──> Task ──> EvaluatorContext
                         ├── case.evaluators + dataset.evaluators
                         │   └── bool | number | str | flat mapping
                         │       └── EvaluationResult / EvaluatorFailure
                         └── ReportCase
                              ├── assertions
                              ├── scores
                              ├── labels
                              ├── metrics / attributes
                              └── evaluator_failures

全部成功 ReportCase + Task failures
  └── EvaluationReport
       └── report_evaluators，逐个执行
            └── analyses / report_evaluator_failures
```

一个 experiment 就是一次 `Dataset.evaluate()` 或 `evaluate_sync()`。
Task 对每个 case 执行一次；`repeat > 1` 时对每个 case 执行指定次数。
case 名会变成 `name [run/repeat]`，原名写入 `source_case_name`。

未设置 `max_concurrency` 时，所有 case 都可并发执行。
同步 Task 被送到 worker thread，异步 Task 直接 await。
同一 case 的 case-specific evaluator 排在列表前面，dataset evaluator 排在后面，但它们由 task group 并发执行。

因此 evaluator 列表顺序不是 gate。
前面的确定性 assertion 为 `False` 时，后面的 `LLMJudge` 仍会调用裁判模型。
[Built-in 指南](https://pydantic.dev/docs/ai/evals/evaluators/built-in/#combining-evaluators)写了“快检查在前”，但 2.27.0 没有 fail-fast 实现。

case evaluator 都结束后，框架按返回值类型分成三组。
布尔值进入 `assertions`，数字进入 `scores`，字符串进入 `labels`。
同名结果按出现次序追加 `_2`、`_3`。

report evaluator 在全部 case 停稳后逐个执行。
它们读取同一份可变 report，并把 analysis 追加到 `report.analyses`。
这一阶段是顺序执行，不与 case evaluator 混在一起。

## 5. 完整 API catalog

本节穷尽 2.27.0 对断言、判分、metric 与聚合直接有用的公开作者面。
provider、模型实现和 OTel exporter 不在本文范围。

### 5.1 `Case`、`Dataset` 与 evaluate

[固定 Dataset 源码](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/dataset.py#L110-L535)给出的构造签名如下。

```python
Case(
    *,
    name: str | None = None,
    inputs: InputsT,
    metadata: MetadataT | None = None,
    expected_output: OutputT | None = None,
    evaluators: tuple[Evaluator[InputsT, OutputT, MetadataT], ...] = (),
)

Dataset(
    *,
    name: str,
    cases: Sequence[Case[InputsT, OutputT, MetadataT]],
    evaluators: Sequence[Evaluator[InputsT, OutputT, MetadataT]] = (),
    report_evaluators: Sequence[ReportEvaluator[InputsT, OutputT, MetadataT]] = (),
)
```

| 字段 | 参数与默认值 | 运行语义 |
|---|---|---|
| `Case.name` | `str \| None = None` | report 使用该名；未命名时展示 `Case N`，但 `EvaluatorContext.name` 仍是 `None` |
| `Case.inputs` | 必填 `InputsT` | 原样传给 Task |
| `Case.metadata` | `MetadataT \| None = None` | case 级静态信息，原样交给 evaluator |
| `Case.expected_output` | `OutputT \| None = None` | `None` 同时表示“没提供”和“期望值就是 None”，两者不可区分 |
| `Case.evaluators` | 空 tuple | 只在该 case 执行，并与 dataset evaluator 合并 |
| `Dataset.name` | 必填 `str` | dataset 身份；不是 experiment 名 |
| `Dataset.cases` | 必填 sequence | 具名 case 不得重名；重复时构造阶段抛 `ValueError` |
| `Dataset.evaluators` | 空 sequence | 对每个 case 执行 |
| `Dataset.report_evaluators` | 空 sequence | 在 case 阶段之后逐个执行 |

异步与同步入口只有运行方式不同，参数相同。
[API reference](https://pydantic.dev/docs/ai/api/pydantic_evals/dataset/#pydantic_evals.dataset.Dataset.evaluate)可用于跳转。

```python
await dataset.evaluate(
    task,
    *,
    name: str | None = None,
    max_concurrency: int | None = None,
    progress: bool = True,
    retry_task: RetryConfig | None = None,
    retry_evaluators: RetryConfig | None = None,
    task_name: str | None = None,
    metadata: dict[str, Any] | None = None,
    repeat: int = 1,
    lifecycle: type[CaseLifecycle] | Callable[[Case], CaseLifecycle] | None = None,
) -> EvaluationReport

dataset.evaluate_sync(
    task,
    *,
    name: str | None = None,
    max_concurrency: int | None = None,
    progress: bool = True,
    retry_task: RetryConfig | None = None,
    retry_evaluators: RetryConfig | None = None,
    task_name: str | None = None,
    metadata: dict[str, Any] | None = None,
    repeat: int = 1,
    lifecycle: type[CaseLifecycle] | Callable[[Case], CaseLifecycle] | None = None,
) -> EvaluationReport
```

| 参数 | 默认语义 | 错误与跳过 |
|---|---|---|
| `task` | 同步或异步一元 callable | Task 抛错会形成 `ReportCaseFailure`，其它 case 继续 |
| `name` | 先用 `task_name`，再用函数名 | 只影响 experiment/report 名 |
| `max_concurrency` | `None`，不设 case 并发上限 | 小于 1 立即抛 `ValueError` |
| `progress` | `True` | 只控制 Rich progress |
| `retry_task` | `None` | 配置后对 Task 再试；最终失败仍是 `ReportCaseFailure` |
| `retry_evaluators` | `None` | 配置后分别再试 evaluator；最终异常通常是 `EvaluatorFailure` |
| `task_name` | 函数名 | 用于 span 与默认 experiment 名 |
| `metadata` | `None` | experiment 级字典，进入 report 与 report evaluator context |
| `repeat` | `1` | 小于 1 立即抛 `ValueError` |
| `lifecycle` | `None` | 每次 case run 创建实例；teardown 抛错会向调用者传播 |

`CaseLifecycle(case)` 是顶层公开导出，并且三个 hook 都是 async。
[固定 lifecycle.py](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/lifecycle.py)给出完整时序。

| hook | 参数与默认实现 | 失败语义 |
|---|---|---|
| `case` property | 返回构造时传入的 `Case` | 只读 |
| `await setup()` | Task 前执行；默认无操作 | exception 记为 `ReportCaseFailure`，仍执行 teardown |
| `await prepare_context(ctx)` | Task 后、evaluator 前执行；默认原样返回 context | exception 记为 `ReportCaseFailure`，仍执行 teardown |
| `await teardown(result)` | evaluator 后执行；默认无操作；result 可为成功、失败或 `None` | exception 向 `evaluate()` 调用者传播，可能中止整次运行 |

数据集编辑与编码 API 也会影响 evaluator 作者。
[固定序列化实现](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/dataset.py#L475-L915)提供以下公开方法。

| API | 完整参数摘要 | 返回与失败 |
|---|---|---|
| `add_case(*, name=None, inputs, metadata=None, expected_output=None, evaluators=())` | 与 `Case` 相同 | 返回 `None`；重名抛 `ValueError` |
| `add_evaluator(evaluator, specific_case=None)` | `None` 表示 dataset 级；字符串表示具名 case | 返回 `None`；找不到 case 抛 `ValueError` |
| `from_file(path, fmt=None, custom_evaluator_types=(), custom_report_evaluator_types=())` | `fmt` 从 `.yaml/.yml/.json` 推断 | 返回 Dataset；格式或 schema 错误抛错 |
| `from_text(contents, fmt='yaml', custom_evaluator_types=(), custom_report_evaluator_types=(), *, default_name=None)` | 读取 YAML 或 JSON 字符串 | 返回 Dataset；名字与内容都没有时抛错 |
| `from_dict(data, custom_evaluator_types=(), custom_report_evaluator_types=(), *, default_name=None)` | 读取 Python dict | 返回 Dataset；Pydantic 校验失败时抛错 |
| `to_file(path, fmt=None, schema_path='./{stem}_schema.json', custom_evaluator_types=(), custom_report_evaluator_types=())` | 写 YAML/JSON，默认同时写 JSON Schema | 没有业务返回值；扩展名未知时抛错 |
| `model_json_schema_with_evaluators(custom_evaluator_types=(), custom_report_evaluator_types=())` | 把内置和自定义 evaluator 放入 schema | 返回 JSON Schema dict |

`EvaluatorSpec` 支持三种 YAML/JSON 形状。
无参数 evaluator 写字符串；单个首参数可写 `{Name: value}`；多个参数写 `{Name: {key: value}}`。
[固定 spec.py](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/evaluators/spec.py)给出了这三种形式。

自定义 evaluator 要参与文件往返，必须显式加 `@dataclass`。
作者还必须在保存和读取两侧传入 `custom_evaluator_types` 或 `custom_report_evaluator_types`。
[Dataset Serialization](https://pydantic.dev/docs/ai/evals/how-to/dataset-serialization/#custom-evaluators)给出了完整路径。

### 5.2 `EvaluatorContext`、`EvaluatorOutput` 与结果语义

[EvaluatorContext 源码](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/evaluators/context.py#L35-L103)定义了 evaluator 的唯一输入。

```python
@dataclass(kw_only=True)
class EvaluatorContext(Generic[InputsT, OutputT, MetadataT]):
    name: str | None
    inputs: InputsT
    metadata: MetadataT | None
    expected_output: OutputT | None
    output: OutputT
    duration: float
    _span_tree: SpanTree | SpanTreeRecordingError
    attributes: dict[str, Any]
    metrics: dict[str, int | float]

    @property
    def span_tree(self) -> SpanTree:
        raise NotImplementedError
```

`duration` 只量 Task；`ReportCase.total_duration` 才包含 evaluator 和 lifecycle 时间。
读取 `span_tree` 时，如果 span 未被捕获，property 会抛 `SpanTreeRecordingError`。
`attributes` 与 `metrics` 来自 Task 内调用的两个写入函数。

[Evaluator 输出源码](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/evaluators/evaluator.py#L20-L113)给出完整联合。

```python
EvaluationScalar = bool | int | finite_float | str

@dataclass
class EvaluationReason:
    value: EvaluationScalar
    reason: str | None = None

EvaluatorOutput = (
    EvaluationScalar
    | EvaluationReason
    | Mapping[str, EvaluationScalar | EvaluationReason]
)
```

| 作者返回 | report 分组 | 无分、失败与命名 |
|---|---|---|
| `bool` | `assertions` | `False` 是明确失败，不是 evaluator 异常 |
| `int` 或有限 `float` | `scores` | 没有默认范围和 threshold |
| `str` | `labels` | 任意字符串都是分类标签 |
| `EvaluationReason(value, reason)` | 由 `value` 类型决定 | `reason` 可在报告中显示 |
| 平面 mapping | 每个 key 形成独立结果 | key 成为名字；空 mapping 表示该 case 不适用 |
| `None`、嵌套 mapping、NaN、正负无穷或其它类型 | 不进入三组 | 形成 `EvaluatorFailure` |
| evaluator 抛异常 | 不产生 assertion、score 或 label | 形成 `EvaluatorFailure`，case Task 结果仍保留 |

框架没有一等 `unscored`、`skip` 或 `unavailable` 值。
空 mapping 是唯一明确的“本 case 不产生结果”形状。
它不会写原因，也无法区分条件不适用、证据不足或作者主动跳过。

`EvaluationResult` 包含 `name`、`value`、`reason`、`source: EvaluatorSpec` 与 `evaluator_version`。
`EvaluatorFailure` 包含名字、错误消息、stacktrace、错误类型、spec 与版本。
[执行适配源码](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/evaluators/_run_evaluator.py#L31-L104)展示了校验和异常捕获。
`EvaluationResult.downcast(*value_types)` 在值命中所给类型时返回窄化结果，否则返回 `None`。
布尔值只有显式传入 `bool` 才会命中，不会因为 `bool` 是 `int` 子类而进入 score。

### 5.3 `Evaluator` 基类和自定义扩展点

[Evaluator API](https://pydantic.dev/docs/ai/api/pydantic_evals/evaluators/#pydantic_evals.evaluators.Evaluator)允许同步或异步实现。

| API | 默认值与同步性 | 作者职责 |
|---|---|---|
| `evaluate(ctx) -> EvaluatorOutput \| Awaitable[EvaluatorOutput]` | abstract；可 `def` 或 `async def` | 实现判分 |
| `evaluate_sync(ctx) -> EvaluatorOutput` | 同步 wrapper | async 实现会运行到完成 |
| `evaluate_async(ctx) -> EvaluatorOutput` | async wrapper | sync `evaluate` 会直接执行，不自动送到 thread |
| `get_default_evaluation_name() -> str` | 类的 serialization name | 改 scalar 结果在 report 中的名字 |
| `get_evaluator_version() -> str \| None` | `None` | 行为改变后提供版本，写入每个结果 |
| `get_serialization_name() -> str` | 类名 | 改 YAML/JSON evaluator 名 |
| `as_spec() -> EvaluatorSpec` | 省略 dataclass 默认字段 | 形成 report provenance 与文件形状 |
| `build_serialization_arguments() -> dict[str, Any]` | dataclass 非默认字段 | 自定义文件编码参数 |

同步 evaluator 如果执行阻塞 I/O，会阻塞 experiment event loop。
源码注释建议覆写 `evaluate_async()`，并用 `anyio.to_thread.run_sync` 包装这种工作。
普通网络检查应直接实现 `async def evaluate`。

### 5.4 全部内置 case evaluator

下列 13 个类是 [`pydantic_evals.evaluators.__all__`](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/evaluators/__init__.py)导出的全部内置 case evaluator。

#### 比较、类型与耗时

| evaluator 与签名 | 同步性与返回 | 默认、失败与跳过语义 |
|---|---|---|
| [`Equals(value, evaluation_name=None)`](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/evaluators/common.py#L35-L48) | sync；`bool` | Python `==`；没有 reason |
| [`EqualsExpected(evaluation_name=None)`](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/evaluators/common.py#L51-L65) | sync；`bool \| {}` | `expected_output is None` 时返回空 mapping，不判失败 |
| [`Contains(value, case_sensitive=True, as_strings=False, evaluation_name=None)`](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/evaluators/common.py#L80-L157) | sync；`EvaluationReason[bool]` | 字符串做 substring；sequence 做 membership；dict 对 dict 做顶层子集；model-like 先转 dict |
| [`IsInstance(type_name, evaluation_name=None)`](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/evaluators/common.py#L160-L181) | sync；`EvaluationReason[bool]` | 对 MRO 的 `__name__` 或 `__qualname__` 做字符串比较，不接收 type object |
| [`MaxDuration(seconds: float \| timedelta)`](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/evaluators/common.py#L184-L197) | sync；`bool` | `ctx.duration <= seconds` 通过，边界值包含在内 |

`Contains.as_strings=True` 会先把两侧交给 `str()`。
当两侧本来就是字符串时，即使 `as_strings=False` 也走字符串分支。
`case_sensitive` 只影响字符串分支。
其它 containment 操作触发 `TypeError` 或 `ValueError` 时，`Contains` 返回带 reason 的 `False`，不会形成 `EvaluatorFailure`。

#### 裁判模型

| evaluator 与签名 | 同步性与返回 | 默认、失败与无分语义 |
|---|---|---|
| [`LLMJudge(rubric, model=None, include_input=False, include_expected_output=False, model_settings=None, score=False, assertion={'include_reason': True})`](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/evaluators/common.py#L230-L293) | async；平面 mapping | 默认只产出带 reason 的布尔 assertion；裁判调用或输出校验异常形成 `EvaluatorFailure` |
| [`GEval(criteria, evaluation_steps, score_range=(1, 5), include_input=False, model=None, model_settings=None, evaluation_name=None)`](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/evaluators/common.py#L296-L349) | async；`EvaluationReason[int]` | steps 不得为空；min 必须小于 max；Judge 分数越界会失败 |

`OutputConfig` 是 total-false TypedDict，只有 `evaluation_name: str` 与 `include_reason: bool`。
`False` 关闭对应输出；空 dict 启用输出但不带 reason。
只启用一种输出时，默认名字就是 `LLMJudge`。
同时启用两种时，默认名字才是 `LLMJudge_score` 与 `LLMJudge_pass`。

两种输出都设为 `False` 时，`LLMJudge` 仍先调用裁判模型，随后返回空 mapping。
这个配置不会节省费用。
指南中的单输出注释使用 `LLMJudge_pass` 或 `LLMJudge_score`，与 2.27.0 源码不一致。

`GEval` 是简化实现。
它让 Judge 直接给一个整数，不使用论文中的 token log-prob 加权期望。
它没有 assertion threshold，也不读取 `expected_output`。
[Standard Quality Metrics](https://pydantic.dev/docs/ai/evals/evaluators/standard-quality-metrics/#g-eval)也明示这一差异。

#### 通用 span 与 agentic evaluator

| evaluator 与签名 | 同步性与返回 | 默认、失败与无分语义 |
|---|---|---|
| [`HasMatchingSpan(query: SpanQuery, evaluation_name=None)`](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/evaluators/common.py#L352-L366) | sync；`bool` | 任一 span 匹配即通过；span tree 不可用时抛错，框架写 `EvaluatorFailure` |
| [`ToolCorrectness(expected_tools, allow_extra=False, include_failed=False, evaluation_name=None)`](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/evaluators/agentic.py#L180-L251) | sync；`EvaluationReason[bool]` | 按 multiset 比较；默认不允许多余工具；无 span 时返回 `False` reason |
| [`TrajectoryMatch(expected_trajectory, order='in_order', include_failed=False, evaluation_name=None)`](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/evaluators/agentic.py#L284-L365) | sync；`EvaluationReason[float]` | `exact` 返回 0/1；`in_order` 用 LCS F1；`any_order` 用 multiset F1；无 span 得 0 |
| [`ArgumentCorrectness(tool_name, expected_arguments, match_mode='subset', occurrence='first', include_failed=False, evaluation_name=None)`](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/evaluators/agentic.py#L381-L490) | sync；`EvaluationReason[bool]` | `subset` 只对子项顶层 key 做子集比较；找不到调用、参数没写入或 JSON 无效都返回 `False` |
| [`MaxToolCalls(max_calls, include_failed=True, evaluation_name=None)`](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/evaluators/agentic.py#L509-L544) | sync；`EvaluationReason[bool]` | 默认把失败尝试计入预算；无 span 返回 `False` |
| [`MaxModelRequests(max_requests, evaluation_name=None)`](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/evaluators/agentic.py#L547-L582) | sync；`EvaluationReason[bool]` | 优先读 `ctx.metrics['requests']`，否则数 chat span；无 span 时先返回 `False` |

agentic evaluator 只数本地执行并生成 span 的工具。
deferred call 永远不计数；sub-agent 的本地工具 span 会计入。
除 `MaxToolCalls` 外，失败或 `ModelRetry` 尝试默认不计数。
`MaxToolCalls` 的默认值相反，因为失败尝试仍消耗预算。

`TrajectoryOrder` 穷尽值是 `'exact' | 'in_order' | 'any_order'`。
`ArgumentMatchMode` 是 `'exact' | 'subset'`。
`ArgumentOccurrence` 是 `'first' | 'last'`，也可传非负整数索引。
期望轨迹和实际轨迹都为空时，`TrajectoryMatch` 的三个模式都返回 1。
只有一侧为空时，三个模式都返回 0。

这些内置类是普通 dataclass，不会在直接构造时全面执行类型校验。
例如无效的 `TrajectoryMatch.order` 会落入 `in_order` 分支，无效的 `ArgumentCorrectness.match_mode` 会表现成 `subset`。
Python 作者应使用 type checker；从 YAML/JSON 读取时才会经过 Pydantic schema 校验。

### 5.5 `LLMJudge`、`GEval` 与低层 Judge API

[固定 Judge 源码](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/evaluators/llm_as_a_judge.py)导出以下全部低层函数和结果模型。

| API | 参数、默认值与返回 |
|---|---|
| `await judge_output(output, rubric, model=None, model_settings=None)` | 只给 Judge 看 output；返回 `GradingOutput` |
| `await judge_input_output(inputs, output, rubric, model=None, model_settings=None)` | 给 Judge 看 input 与 output；返回 `GradingOutput` |
| `await judge_output_expected(output, expected_output, rubric, model=None, model_settings=None)` | 给 Judge 看 output 与 expected；返回 `GradingOutput` |
| `await judge_input_output_expected(inputs, output, expected_output, rubric, model=None, model_settings=None)` | 给 Judge 看三项材料；返回 `GradingOutput` |
| `await judge_g_eval(output, criteria, evaluation_steps, score_range=(1, 5), inputs=None, model=None, model_settings=None)` | 返回 `GEvalOutput`；参数与越界校验同高层 `GEval` |
| `set_default_judge_model(model) -> None` | 改进程级默认裁判模型 |

`GradingOutput` 的字段是 `reason: str`、`pass_: bool` 和 `score: float`。
JSON 别名使用 `pass`。
`GEvalOutput` 的字段是 `reason: str` 和 `score: int`。

2.27.0 的进程级默认模型是 `openai:gpt-5.2`。
每个高层或低层调用都可用 `model` 单独替换。
`model_settings` 原样交给 Pydantic AI model request。

`LLMJudge` 根据两个 include flag 选择四个低层函数。
材料依次放入 `<Input>`、`<Output>`、`<ExpectedOutput>` 和 `<Rubric>` 区段。
如果 expected 值是 `None`，对应区段不会出现。

官方指南把 score 描述成 0 到 1。
固定 `GradingOutput.score` 只是普通 `float`，没有范围 validator。
因此 2.27.0 不能在运行时保证这个范围。
`GEval` 的整数范围则有显式校验。

### 5.6 `SpanQuery`、`SpanTree` 与 `SpanNode`

`SpanQuery` 是 total-false TypedDict。
同一层字段默认用 AND 组合；只有 `or_` 要独占该层。
[固定查询实现](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/otel/span_tree.py#L29-L88)的字段全集如下。

| 分类 | 全部字段 | 精确语义 |
|---|---|---|
| 名字 | `name_equals`、`name_contains`、`name_matches_regex` | regex 使用 `re.match`，从字符串开头匹配 |
| attribute | `has_attributes`、`has_attribute_keys` | 前者按值相等；期望 dict/list 也可匹配保存成 JSON 字符串的 attribute |
| 状态 | `has_status` | 只接受 `'unset' | 'ok' | 'error'` |
| 时间 | `min_duration`、`max_duration` | float 按秒，或传 `timedelta`；边界包含在内 |
| 逻辑 | `not_`、`and_`、`or_` | `or_` 与同层其它字段并用会抛 `ValueError` |
| 直接子项 | `min_child_count`、`max_child_count`、`some_child_has`、`all_children_have`、`no_child_has` | 只检查直接 child |
| 后代 | `min_descendant_count`、`max_descendant_count`、`some_descendant_has`、`all_descendants_have`、`no_descendant_has` | 按 DFS 检查全部 descendant |
| 祖先与深度 | `min_depth`、`max_depth`、`some_ancestor_has`、`all_ancestors_have`、`no_ancestor_has` | root 深度为 0 |
| 递归边界 | `stop_recursing_when` | descendant 或 ancestor 遇到匹配节点后不再向外走 |

`SpanTree.find/first/any(predicate)` 接收 `SpanQuery` 或 `Callable[[SpanNode], bool]`。
`SpanNode` 对直接子项提供 `find_children/first_child/any_child`。
它还提供对应的 descendant 与 ancestor 三组方法。
[SpanTree API](https://pydantic.dev/docs/ai/evals/evaluators/span-based/#spantree-api)列出了遍历入口。

`SpanNode` 公开名字、trace/span ID、parent ID、起止时间、attribute、状态、duration、parent、children、descendants 与 ancestors。
`repr_xml()` 可用于本地诊断。
`SpanTree.repr_xml()` 提供同样的树形文本。

2.27.0 对 count 与 depth 条件使用 truthy 判断。
因此 `max_child_count=0`、`max_descendant_count=0` 与 `max_depth=0` 不会生效。
需要严格判断零值时，应改用接收 `SpanNode` 的 callable predicate。

### 5.7 `ReportEvaluator`、四个内置聚合器与 analysis

[ReportEvaluator 源码](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/evaluators/report_evaluator.py)定义两个核心形状。

```python
@dataclass(kw_only=True)
class ReportEvaluatorContext:
    name: str
    report: EvaluationReport
    experiment_metadata: dict[str, Any] | None

class ReportEvaluator:
    def evaluate(
        self, ctx: ReportEvaluatorContext
    ) -> (
        ReportAnalysis
        | list[ReportAnalysis]
        | Awaitable[ReportAnalysis | list[ReportAnalysis]]
    ):
        raise NotImplementedError

    async def evaluate_async(
        self, ctx: ReportEvaluatorContext
    ) -> ReportAnalysis | list[ReportAnalysis]:
        raise NotImplementedError
```

四个内置类来自 [固定 report_common.py](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/evaluators/report_common.py)。

| evaluator 与完整构造参数 | 返回 | 缺数据与失败 |
|---|---|---|
| `ConfusionMatrixEvaluator(predicted_from='output', predicted_key=None, expected_from='expected_output', expected_key=None, title='Confusion Matrix')` | sync；一个 `ConfusionMatrix` | 任一侧缺值就跳过该 case；`labels` 需要 key，`metadata` 可选 key |
| `PrecisionRecallEvaluator(score_key, positive_from, positive_key=None, score_from='scores', title='Precision-Recall Curve', n_thresholds=100)` | sync；`PrecisionRecall` 与 AUC `ScalarResult` | 缺 score 或正类事实的 case 被跳过；无有效 case 时曲线为空，AUC 是 NaN |
| `ROCAUCEvaluator(score_key, positive_from, positive_key=None, score_from='scores', title='ROC Curve', n_thresholds=100)` | sync；`LinePlot` 与 AUC `ScalarResult` | 无有效 case 或只有一个类别时曲线为空，AUC 是 NaN |
| `KolmogorovSmirnovEvaluator(score_key, positive_from, positive_key=None, score_from='scores', title='KS Plot', n_thresholds=100)` | sync；两条 CDF 的 `LinePlot` 与 KS `ScalarResult` | 无有效 case 或只有一个类别时曲线为空，KS 是 NaN |

`predicted_from` 与 `expected_from` 的全集是 `expected_output | output | metadata | labels`。
`score_from` 是 `scores | metrics`。
`positive_from` 是 `expected_output | assertions | labels`。
从 assertion 或 label 取正类事实时，`positive_key` 必填。

`n_thresholds` 只限制展示点。
PR、ROC 和 KS 的统计量都用完整阈值集合计算。
report evaluator 抛异常时，框架把失败写入 `report.report_evaluator_failures`，不向调用者抛出。

混淆矩阵的行是 expected，列是 predicted。
PR 从 `recall=0, precision=1` 的参照点开始，并对完整曲线做梯形积分。
ROC 从 `(0, 0)` 开始，对完整曲线做梯形积分；随机对角线只用于展示。
KS 是正类与负类经验 CDF 的最大垂直距离。

`positive_from='expected_output'` 与 `positive_from='labels'` 都调用 Python `bool()`。
因此非空字符串 `'negative'` 也会被当成正类。
分类任务宜返回专门的 boolean assertion，再用 `positive_from='assertions'`。

[固定 analysis 联合](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/reporting/analyses.py)有五个分支。

| analysis | 必填字段 | 默认字段 |
|---|---|---|
| `ConfusionMatrix` | `class_labels: list[str]`、`matrix: list[list[int]]` | `type='confusion_matrix'`、`title='Confusion Matrix'`、`description=None` |
| `PrecisionRecall` | `curves: list[PrecisionRecallCurve]` | `type='precision_recall'`、`title='Precision-Recall Curve'`、`description=None` |
| `ScalarResult` | `title: str`、`value: float | int` | `type='scalar'`、`description=None`、`unit=None` |
| `TableResult` | `title`、`columns`、`rows` | `type='table'`、`description=None` |
| `LinePlot` | `title`、`x_label`、`y_label`、`curves` | `type='line_plot'`、`description=None`、`x_range=None`、`y_range=None` |

`PrecisionRecallCurve(name, points, auc=None)` 使用 `PrecisionRecallPoint(threshold, precision, recall)`。
`LinePlotCurve(name, points, style='solid', step=None)` 使用 `LinePlotPoint(x, y)`。
style 还可选 `'dashed'`；step 可选 `'start' | 'middle' | 'end'`。

### 5.8 报告、聚合、metric 与 attribute

[EvaluationReport 源码](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/reporting/__init__.py#L300-L683)公开以下数据。

| 类型 | 字段 |
|---|---|
| `ReportCase` | `name`、`inputs`、`metadata`、`expected_output`、`output`、`metrics`、`attributes`、`scores`、`labels`、`assertions`、`task_duration`、`total_duration`、`source_case_name`、trace/span ID、`evaluator_failures` |
| `ReportCaseFailure` | case 身份字段、`error_message`、`error_stacktrace`、`source_case_name` 与 trace/span ID |
| `EvaluationReport` | `name`、`cases`、`failures`、`analyses`、`report_evaluator_failures`、`experiment_metadata` 与 trace/span ID |
| `ReportCaseGroup` | 原 case 身份、成功 runs、failures 与 `summary` |
| `ReportCaseAggregate` | `scores`、label 分布、`metrics`、总体 assertion pass rate 与平均耗时 |

`case_groups()` 在 `repeat == 1` 时返回 `None`。
其它情况按 `source_case_name` 返回 `list[ReportCaseGroup]`。
`averages()` 返回 `ReportCaseAggregate | None`。

终端报告有四个公开入口。
下面列出 2.27.0 的完整参数，不用省略号代替选项。

```python
report.render(
    width=None,
    baseline=None,
    *,
    include_input=False,
    include_metadata=False,
    include_expected_output=False,
    include_output=False,
    include_durations=True,
    include_total_duration=False,
    include_removed_cases=False,
    include_averages=True,
    include_errors=True,
    include_error_stacktrace=False,
    include_evaluator_failures=True,
    include_analyses=True,
    input_config=None,
    metadata_config=None,
    output_config=None,
    score_configs=None,
    label_configs=None,
    metric_configs=None,
    duration_config=None,
    include_reasons=False,
) -> str

report.print(
    width=None,
    baseline=None,
    *,
    console=None,
    include_input=False,
    include_metadata=False,
    include_expected_output=False,
    include_output=False,
    include_durations=True,
    include_total_duration=False,
    include_removed_cases=False,
    include_averages=True,
    include_errors=True,
    include_error_stacktrace=False,
    include_evaluator_failures=True,
    include_analyses=True,
    input_config=None,
    metadata_config=None,
    output_config=None,
    score_configs=None,
    label_configs=None,
    metric_configs=None,
    duration_config=None,
    include_reasons=False,
) -> None

report.console_table(
    baseline=None,
    *,
    include_input=False,
    include_metadata=False,
    include_expected_output=False,
    include_output=False,
    include_durations=True,
    include_total_duration=False,
    include_removed_cases=False,
    include_averages=True,
    include_evaluator_failures=True,
    input_config=None,
    metadata_config=None,
    output_config=None,
    score_configs=None,
    label_configs=None,
    metric_configs=None,
    duration_config=None,
    include_reasons=False,
    with_title=True,
) -> RenderableType

report.failures_table(
    *,
    include_input=False,
    include_metadata=False,
    include_expected_output=False,
    include_error_message=True,
    include_error_stacktrace=True,
    input_config=None,
    metadata_config=None,
) -> RenderableType
```

`RenderValueConfig` 的全集是 `value_formatter`、`diff_checker`、`diff_formatter` 与 `diff_style`。
`RenderNumberConfig` 的全集是 `value_formatter`、`diff_formatter`、`diff_atol`、`diff_rtol`、`diff_increase_style` 与 `diff_decrease_style`。
两个 TypedDict 都是 total-false；未传字段由 renderer 推断默认格式。

低层 `EvaluationRenderer` 的构造字段全部必填。
列开关是 `include_input`、`include_metadata`、`include_expected_output`、`include_output`、`include_durations` 与 `include_total_duration`。
行开关是 `include_removed_cases` 与 `include_averages`。

格式字段是 `input_config`、`metadata_config`、`output_config`、`score_configs`、`label_configs`、`metric_configs` 与 `duration_config`。
其余字段是 `include_reasons`、`include_error_message`、`include_error_stacktrace` 与 `include_evaluator_failures`。

它公开 `build_table(report, *, with_title=True)`、`build_diff_table(report, baseline, *, with_title=True)` 与 `build_failures_table(report)`。
五个列检查方法是 `include_scores`、`include_labels`、`include_metrics`、`include_assertions` 与 `include_evaluator_failures_column`。
它们都接收 report 和可选参照报告，并返回 boolean。

三个公开 TypeAdapter 是 `EvaluationReportAdapter`、`ReportCaseAdapter` 与 `ReportCaseFailureAdapter`。
它们分别编码和校验 report、成功 case 与 Task failure。
`ReportCaseAggregate.average(cases)` 和 `average_from_aggregates(aggregates)` 是两个公开静态聚合函数。

普通 run 的 score 和 metric 按 key 分别求平均。
某个 key 缺失的 case 不进入该 key 的分母。
label 聚合为每个字符串的频率。
assertion 只给一项跨名字的总体通过率。

Task failure 不进入 `report.cases`，因此也不进入这些平均数。
多次 run 先在每个原 case 内聚合，再对有成功 run 的 case 等权平均。
作者必须同时查看 `failures`，不能只看 Averages 行。
report diff 的 Averages 对两侧都使用平面 case 平均，不调用两层 `averages()`。
部分 repeat 失败时，diff 表的平均值可能与单份 report 的 Averages 不同。

`include_reasons` 只影响单份报告，不影响 diff。
`console_table()` 只构造主表；analysis 与 Task failure 由 `print()` 和 `render()` 另外追加。

[Metrics & Attributes](https://pydantic.dev/docs/ai/evals/how-to/metrics-attributes/)对应两个同步函数。

| API | 行为 |
|---|---|
| `set_eval_attribute(name: str, value: Any) -> None` | 在当前 Task run 的同名 key 写入值；再次调用会替换 |
| `increment_eval_metric(name: str, amount: int | float) -> None` | 从 0 累加；结果为 0 且之前不存在时不保留 key |

两者在 `Dataset` Task 外调用时静默无操作。
框架还会从 model request span 提取 `requests`、`cost` 和 token usage metric。

### 5.9 online evaluator 与低层再次判分

online 路径复用同一个 `Evaluator`。
它与判分直接有关，但 sink 和 exporter 的具体实现不在本文范围。
[固定 online.py](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/online.py)公开以下 evaluator 入口。

**研究观察。**
在仅含 `pydantic-evals==2.27.0` 的全新 uv 临时安装中，导入该模块会因缺少 `sniffio` 而失败。
[固定实现](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pydantic_evals/_online.py)直接导入它，[固定 pyproject](https://github.com/pydantic/pydantic-ai/blob/f9cd74f8ebca92a7acfa6346df7bf67f3f9e12cc/pydantic_evals/pyproject.toml)却没有声明这项依赖。
本研究用 `sniffio==1.3.1` 恢复了导入；第 3 节给出固定命令。
这是 2.27.0 发布物的依赖缺口，不是 online API 约定的正常失败语义。

| API | 参数与默认值 | 结果语义 |
|---|---|---|
| `@evaluate(*evaluators, target=None, msg_template=None, span_name=None, extract_args=False, record_return=False)` | 使用全局 config 装饰同步或异步函数 | 被装饰函数先返回；evaluator 在后台执行 |
| `OnlineEvaluator(evaluator, sample_rate=None, max_concurrency=10, sink=None, on_max_concurrency=None, on_sampling_error=None, on_error=None, run_on_errors=False)` | 每个 evaluator 的抽样、并发与错误策略 | 默认只评估成功调用；并发满时静默丢弃 |
| `OnlineEvalConfig(default_sink=None, default_sample_rate=1.0, emit_otel_events=True, include_baggage=True, sampling_mode='independent', enabled=True, metadata=None, on_max_concurrency=None, on_sampling_error=None, on_error=None)` | 跨 evaluator 默认值 | 没有 OTel event 且没有 sink 时，evaluator 不执行 |
| `OnlineEvalConfig.evaluate(*evaluators, target=None, msg_template=None, span_name=None, extract_args=False, record_return=False)` | 使用该实例而不是全局 config | 返回 decorator |
| `OnlineEvalConfig.should_evaluate() -> bool` | 检查 enabled、作用域禁用标记与离线 Task 嵌套 | 离线 Dataset Task 内不派发 online evaluator |
| `DEFAULT_CONFIG` | 全局 `OnlineEvalConfig` 实例 | 模块级 `evaluate()` 与 `configure()` 共用 |
| `disable_evaluation()` | context manager | 作用域内不派发 online evaluator |
| `await wait_for_evaluations(timeout=30.0)` | 等待后台 task 和 thread | 便于测试与进程退出前收尾 |
| `await run_evaluators(evaluators, context)` | 并发执行一组 evaluator | 返回 `(list[EvaluationResult], list[EvaluatorFailure])` |
| `EvaluatorContextSource.fetch/fetch_many(SpanReference)` | 用户实现的 async protocol | 从外部保存面重建 context |

模块级配置函数的完整签名如下。
`UNSET` 表示保留全局实例中的原值；显式 `None` 可清空允许为空的字段。

```python
configure(
    *,
    default_sink=UNSET,
    default_sample_rate=UNSET,
    sampling_mode=UNSET,
    enabled=UNSET,
    metadata=UNSET,
    on_max_concurrency=UNSET,
    on_sampling_error=UNSET,
    on_error=UNSET,
    emit_otel_events=UNSET,
    include_baggage=UNSET,
) -> None
```

`SamplingContext` 的字段全集是 `evaluator`、调用输入 `inputs`、config `metadata` 与本次调用的 `call_seed`。
`SpanReference` 只有 `trace_id: str` 和 `span_id: str`。
`EvaluatorContextSource.fetch(span)` 默认委托 `fetch_many([span])`；实现者至少要提供 `fetch_many(spans)`。

`OnMaxConcurrencyCallback` 接收 `EvaluatorContext`，可同步或异步。
`OnSamplingErrorCallback` 同步接收 exception 与 evaluator。
`OnErrorLocation` 是 `'sink' | 'on_max_concurrency'`。
`OnErrorCallback` 接收 exception、context、evaluator 与 `OnErrorLocation`，可同步或异步。
抽样 callable 在被装饰函数执行前调用。
它抛错且没有 `on_sampling_error` 时，原函数不会开始，exception 直接交给调用者。

`SamplingMode` 是 `'independent' | 'correlated'`。
前者为每个 evaluator 独立抽样；后者让同一次调用共享随机数。
`sample_rate` 可为 0 到 1 的数字，也可为接收 `SamplingContext` 的同步 callable。
`run_on_errors=True` 时，被装饰函数抛出的 exception 会作为 `EvaluatorContext.output` 交给 evaluator。
原 exception 在派发后仍向调用者传播。

`SinkCallback` 接收 results、failures 与 context，可同步或异步。
`EvaluationSink`、`CallbackSink`、`SinkPayload` 与 `SinkCallback` 只决定结果发送位置。
它们不改变判分值、跳过规则或聚合算法，因此不展开具体 transport 字段。

## 6. 四个可抄完整场景

### 6.1 确定性检查：期望值、包含、类型与耗时

这个脚本无网络调用。
四个 evaluator 都生成 boolean assertion。

```python
from pydantic_evals import Case, Dataset
from pydantic_evals.evaluators import (
    Contains,
    EqualsExpected,
    IsInstance,
    MaxDuration,
)


dataset = Dataset[str, str, dict[str, str]](
    name='normalizer',
    cases=[
        Case(
            name='spaces',
            inputs='  hello world  ',
            expected_output='HELLO WORLD',
            metadata={'kind': 'whitespace'},
        ),
        Case(
            name='numbers',
            inputs=' hello 123 ',
            expected_output='HELLO 123',
            metadata={'kind': 'mixed'},
        ),
    ],
    evaluators=[
        EqualsExpected(evaluation_name='exact'),
        Contains(value='HELLO', evaluation_name='has_hello'),
        IsInstance(type_name='str', evaluation_name='is_text'),
        MaxDuration(seconds=0.5),
    ],
)


def normalize(text: str) -> str:
    return ' '.join(text.split()).upper()


report = dataset.evaluate_sync(normalize, progress=False)
report.print(
    include_input=True,
    include_metadata=True,
    include_expected_output=True,
    include_output=True,
    include_durations=False,
    include_reasons=True,
)
```

这段代码不会因为 assertion 为 `False` 自动抛错。
CI gate 的显式写法见第 7 节。

### 6.2 开放 Judge：同时保留 score、assertion 与 reason

先安装 OpenAI extra，并设置 `OPENAI_API_KEY`。
该脚本会产生付费模型调用。

```bash
uv add "pydantic-evals==2.27.0" "pydantic-ai-slim[openai]==2.27.0"
export OPENAI_API_KEY="your-key"
```

```python
from pydantic_evals import Case, Dataset
from pydantic_evals.evaluators import Contains, LLMJudge


dataset = Dataset[str, str, None](
    name='support_answer',
    cases=[
        Case(
            name='refund_window',
            inputs='How long do I have to request a refund?',
            expected_output='Refunds may be requested within 14 days of delivery.',
        ),
    ],
    evaluators=[
        Contains(value='14 days', evaluation_name='mentions_window'),
        LLMJudge(
            rubric=(
                'The answer states the 14-day deadline, stays consistent with '
                'the expected answer, and invents no exception.'
            ),
            model='openai:gpt-5.2',
            include_input=True,
            include_expected_output=True,
            score={
                'evaluation_name': 'policy_quality',
                'include_reason': True,
            },
            assertion={
                'evaluation_name': 'policy_pass',
                'include_reason': True,
            },
        ),
    ],
)


def answer(_: str) -> str:
    return 'You can request a refund within 14 days of delivery.'


report = dataset.evaluate_sync(answer, progress=False)
report.print(
    include_input=True,
    include_expected_output=True,
    include_output=True,
    include_durations=False,
    include_reasons=True,
)
```

`mentions_window` 是确定性 assertion。
`policy_quality` 是 numeric score，`policy_pass` 是 Judge assertion。
两者并发执行；前者失败不会阻止 Judge 调用。

### 6.3 组合与聚合：一个 evaluator 产出五项结果

这个分类例子只使用本地 Python。
case evaluator 生成两个 label、一个 score 和两个 assertion。
四个 report evaluator 随后生成混淆矩阵、PR、ROC 与 KS 分析。

```python
from dataclasses import dataclass

from pydantic_evals import Case, Dataset
from pydantic_evals.evaluators import (
    ConfusionMatrixEvaluator,
    EvaluationReason,
    Evaluator,
    EvaluatorContext,
    EvaluatorOutput,
    KolmogorovSmirnovEvaluator,
    PrecisionRecallEvaluator,
    ROCAUCEvaluator,
)


@dataclass
class ClassificationSignals(Evaluator[str, float, None]):
    threshold: float = 0.5

    def evaluate(
        self,
        ctx: EvaluatorContext[str, float, None],
    ) -> EvaluatorOutput:
        predicted_positive = ctx.output >= self.threshold
        expected_positive = bool(ctx.expected_output)
        return {
            'predicted_label': str(predicted_positive),
            'expected_label': str(expected_positive),
            'confidence': ctx.output,
            'correct': EvaluationReason(
                value=predicted_positive == expected_positive,
                reason=(
                    f'probability={ctx.output:.2f}, '
                    f'threshold={self.threshold:.2f}'
                ),
            ),
            'expected_positive': expected_positive,
        }


dataset = Dataset[str, float, None](
    name='spam_classifier',
    cases=[
        Case(name='p1', inputs='win a free prize', expected_output=1.0),
        Case(name='p2', inputs='limited offer now', expected_output=1.0),
        Case(name='n1', inputs='team meeting at ten', expected_output=0.0),
        Case(name='n2', inputs='your invoice is attached', expected_output=0.0),
    ],
    evaluators=[ClassificationSignals()],
    report_evaluators=[
        ConfusionMatrixEvaluator(
            predicted_from='labels',
            predicted_key='predicted_label',
            expected_from='labels',
            expected_key='expected_label',
        ),
        PrecisionRecallEvaluator(
            score_key='confidence',
            positive_from='assertions',
            positive_key='expected_positive',
        ),
        ROCAUCEvaluator(
            score_key='confidence',
            positive_from='assertions',
            positive_key='expected_positive',
        ),
        KolmogorovSmirnovEvaluator(
            score_key='confidence',
            positive_from='assertions',
            positive_key='expected_positive',
        ),
    ],
)


def spam_probability(text: str) -> float:
    if 'free prize' in text:
        return 0.95
    if 'limited offer' in text:
        return 0.80
    if 'invoice' in text:
        return 0.35
    return 0.10


report = dataset.evaluate_sync(spam_probability, progress=False)
report.print(
    include_input=True,
    include_output=True,
    include_durations=False,
    include_reasons=True,
)

for analysis in report.analyses:
    print(analysis.model_dump())
```

`expected_positive` 不是“模型答对” assertion。
它把正类标签提供给 report evaluator。
CI 如果汇总所有 assertion，必须排除这类事实字段，或不要把它当 gate。
这一点暴露了 boolean 既是事实又是 assertion 的类型重载。

### 6.4 span 判定：证明 Task 执行过数据库区段

这个脚本需要 Logfire extra，不需要远端 token。
`send_to_logfire='if-token-present'` 在没有 token 时只做本地捕获。

```python
import logfire

from pydantic_evals import Case, Dataset
from pydantic_evals.evaluators import HasMatchingSpan


logfire.configure(send_to_logfire='if-token-present')


def lookup_customer(customer_id: str) -> str:
    with logfire.span('database_query', customer_id=customer_id):
        return 'Ada'


dataset = Dataset[str, str, None](
    name='customer_lookup',
    cases=[
        Case(
            name='known_customer',
            inputs='customer-42',
            expected_output='Ada',
        )
    ],
    evaluators=[
        HasMatchingSpan(
            query={
                'name_equals': 'database_query',
                'has_attribute_keys': ['customer_id'],
            },
            evaluation_name='queried_database',
        )
    ],
)


report = dataset.evaluate_sync(lookup_customer, progress=False)
report.print(include_output=True, include_durations=False)
```

## 7. 结果、诊断、artifact、CI 与再次判分

### 7.1 先区分三类失败

| 状态 | 保存位置 | Task 输出是否保留 | 默认是否抛给调用者 |
|---|---|---|---|
| assertion 为 `False` | `ReportCase.assertions` | 是 | 否 |
| evaluator 抛错或返回非法值 | `ReportCase.evaluator_failures` | 是 | 否 |
| Task 抛错 | `EvaluationReport.failures` | 否 | 否 |
| report evaluator 抛错 | `report_evaluator_failures` | 已有 case 都保留 | 否 |
| lifecycle teardown 抛错 | 不保证形成 report | 取决于时点 | 是 |

诊断时应打开 `include_reasons=True`、`include_evaluator_failures=True` 与 `include_errors=True`。
Task stacktrace 由 `include_error_stacktrace=True` 控制。
参照报告可传给 `render(baseline=old_report)`、`print(baseline=old_report)` 或 `console_table(baseline=old_report)`。

### 7.2 把 report 保存为 JSON artifact

框架导出 Pydantic `TypeAdapter`，没有 `report.to_file()`。
下面的写法使用公开 `EvaluationReportAdapter`。

```python
from pathlib import Path

from pydantic_evals.reporting import EvaluationReportAdapter


artifact_path = Path('artifacts/evaluation-report.json')
artifact_path.parent.mkdir(parents=True, exist_ok=True)
artifact_path.write_bytes(EvaluationReportAdapter.dump_json(report, indent=2))

restored_report = EvaluationReportAdapter.validate_json(
    artifact_path.read_bytes()
)
```

JSON report 包含结果、reason、evaluator spec、错误、analysis 与 trace/span ID。
它不包含 `EvaluatorContext.span_tree`。
外部文件附件也没有一等字段；作者只能把小型结构写入 attribute，或另行管理文件并保存定位信息。

### 7.3 显式建立 CI gate

Pydantic Evals 不会依据 report 自动退出 1。
下面是一种严格策略，不是框架默认行为。
它要求至少有一个真正用于 gate 的 assertion，并拒绝 Task、evaluator 与 report evaluator 错误。

```python
from collections.abc import Iterable

from pydantic_evals.reporting import EvaluationReport


def ci_gate(
    report: EvaluationReport,
    *,
    assertion_names: Iterable[str],
) -> bool:
    selected = set(assertion_names)
    assertion_results = [
        result
        for case in report.cases
        for name, result in case.assertions.items()
        if name in selected
    ]
    return (
        bool(assertion_results)
        and not report.failures
        and not report.report_evaluator_failures
        and all(not case.evaluator_failures for case in report.cases)
        and all(result.value for result in assertion_results)
    )


if not ci_gate(
    report,
    assertion_names={'exact', 'has_hello', 'is_text', 'MaxDuration'},
):
    print(report.render(include_reasons=True, include_error_stacktrace=True))
    raise SystemExit(1)
```

numeric score、label 和 report analysis 不会自行建立门槛。
如果 CI 需要 AUC、平均 score 或失败率限制，作者必须明确选择字段、缺值策略与比较规则。

### 7.4 再次判分的真实能力

`run_evaluators(evaluators, context)` 是公开低层入口。
它并发执行 evaluator，返回扁平结果与失败列表，不生成 `EvaluationReport`。
它适合对已经保存并重建的 `EvaluatorContext` 更换 rubric 或 evaluator。

`EvaluatorContextSource` 只有 protocol，没有随包的存储实现。
作者要自行实现 `fetch()` 与 `fetch_many()`，并用 `SpanReference(trace_id, span_id)` 找回完整 context。
仅有第 7.2 节的 JSON report 时，span evaluator 无法完整再次执行。

report evaluator 可以手工构造 `ReportEvaluatorContext` 再调用 `evaluate_async()`。
框架没有“加载 report、换全部 evaluator、生成新 report”的一体化命令。
因此 Pydantic Evals 具备低层再次判分原语，但没有完整 regrade workflow。

## 8. 自定义扩展

### 8.1 同步、异步和 metadata evaluator

最小自定义 evaluator 是普通子类。
需要构造参数、文件往返或清晰 repr 时加 `@dataclass`。

```python
from dataclasses import dataclass

from pydantic_evals.evaluators import (
    EvaluationReason,
    Evaluator,
    EvaluatorContext,
)


@dataclass
class MetadataThreshold(Evaluator[str, str, dict[str, int]]):
    default_min_length: int = 20

    def evaluate(
        self,
        ctx: EvaluatorContext[str, str, dict[str, int]],
    ) -> EvaluationReason:
        minimum = (
            ctx.metadata.get('min_length', self.default_min_length)
            if ctx.metadata
            else self.default_min_length
        )
        actual = len(ctx.output)
        return EvaluationReason(
            value=actual >= minimum,
            reason=f'length={actual}, minimum={minimum}',
        )

    def get_evaluator_version(self) -> str | None:
        return 'v1'
```

外部 I/O 使用 `async def evaluate`。
框架会自动 await。
如果一个 evaluator 返回平面 mapping，它可同时生成 assertion、score 与 label。
空 mapping 可做条件不适用，但无法保存跳过原因。

### 8.2 自定义 report evaluator

report evaluator 适合跨 case 统计，不适合单 case gate。
它可同步或异步返回一个或多个 `ReportAnalysis`。

```python
from dataclasses import dataclass

from pydantic_evals.evaluators import (
    ReportEvaluator,
    ReportEvaluatorContext,
)
from pydantic_evals.reporting.analyses import ScalarResult


@dataclass
class TaskFailureRate(ReportEvaluator):
    title: str = 'Task Failure Rate'

    def evaluate(self, ctx: ReportEvaluatorContext) -> ScalarResult:
        success_count = len(ctx.report.cases)
        failure_count = len(ctx.report.failures)
        total = success_count + failure_count
        value = failure_count / total if total else 0.0
        return ScalarResult(title=self.title, value=value)
```

这项 analysis 只显示数值。
它不会让 experiment 失败。
需要 CI gate 时，调用者仍要比较 `ScalarResult.value`。

### 8.3 自定义 span predicate

`SpanTree` 与 `SpanNode` 的查询方法也接受 Python callable。
这比 `SpanQuery` 更灵活，但不能直接写入 YAML/JSON evaluator spec。

```python
from dataclasses import dataclass

from pydantic_evals.evaluators import (
    EvaluationReason,
    Evaluator,
    EvaluatorContext,
)


@dataclass
class NoSlowErrorSpan(Evaluator):
    max_seconds: float = 1.0

    def evaluate(self, ctx: EvaluatorContext) -> EvaluationReason:
        matches = ctx.span_tree.find(
            lambda node: (
                node.status == 'error'
                and node.duration.total_seconds() > self.max_seconds
            )
        )
        return EvaluationReason(
            value=not matches,
            reason=f'{len(matches)} slow error span(s)',
        )
```

这种 evaluator 会在 span tree 不可用时抛错，并形成 `EvaluatorFailure`。
如果作者想把缺 span 当成明确 `False`，必须捕获 `SpanTreeRecordingError` 并返回自己的 reason。

### 8.4 第三方 metric

[Third-Party Integrations](https://pydantic.dev/docs/ai/evals/evaluators/framework-integrations/)采用同一模式：在 `Evaluator.evaluate` 内调用外部 metric，再把结果归一成合法 scalar 或 `EvaluationReason`。
框架不为 Ragas、DeepEval 或其它库建立第二种结果协议。
这保留了 report 分组与错误呈现的一致性。

## 9. 好在哪里

以下是研究判断，不是 Pydantic 官方承诺。

1. **typed context 让依赖显式。**
   `inputs`、`output`、`expected_output`、`metadata`、耗时、metric 与 span tree 在一个对象中。
   自定义 evaluator 不必接收松散 `**kwargs`，IDE 能跟随 Dataset 泛型。

2. **返回语法短，报告分组稳定。**
   `bool`、数字和字符串自然对应 assertion、score 与 label。
   `EvaluationReason` 只在需要说明时增加一层，不强迫简单检查构造大对象。

3. **一个 evaluator 可原子地产生相关读数。**
   平面 mapping 适合同时返回 `correct`、`confidence` 和 `category`。
   每个 key 在报告中独立呈现，避免为同一计算重复取值。

4. **case 与 report 两个层级分工清楚。**
   单样本判断与 PR、ROC、KS、混淆矩阵使用不同基类。
   聚合器直接读 typed report，不要求作者先导出 DataFrame。

5. **失败对象保留足够诊断。**
   evaluator spec、版本、reason、stacktrace 与 error type 都在结果模型中。
   Task 失败和 evaluator 失败也不会互相冒充。

6. **文件形状与 Python 类共用一套 evaluator spec。**
   YAML/JSON 自动生成 schema。
   自定义 dataclass 也能加入 registry，适合把 cases 放入版本控制。

7. **span 查询比手写 event 遍历紧凑。**
   `SpanQuery` 同时表达名字、attribute、耗时、状态与树关系。
   agentic evaluator 又把常见工具轨迹算法做成具名类。

8. **report diff 是低成本回归阅读面。**
   同一 `print/render` API 接受参照报告。
   数字、label、metric、case 新增与删除在终端同面比较。

## 10. 不好的地方与不应类比 NiceEval 的边界

以下判断都针对 2.27.0。

1. **score、assertion 与 gate 没有完整连接。**
   numeric score 没有 threshold。
   boolean assertion 也不改变进程退出码。
   report analysis 同样只是展示数据。

2. **没有一等的证据不足状态。**
   空 mapping 不带 reason。
   不同内置 span evaluator 又把缺 span 分别写成 failure、`False` 或 0。
   三种做法会让聚合口径不一致。

3. **`None` 不能表达合法的期望输出。**
   `EqualsExpected` 把它当作未提供并跳过。
   需要验证 Task 返回 `None` 时，只能改用 `Equals(None)`。

4. **列表顺序容易制造错误心智。**
   case evaluator 实际并发执行。
   指南的“快检查在前、昂贵 Judge 在后”不会产生 fail-fast。
   作者若按文字理解，会多付模型费用。

5. **同步 evaluator 的阻塞风险交给作者。**
   同步 Task 会送入 thread，同步 evaluator 却直接跑在 event loop。
   两处相似的 callable 有不同调度语义。

6. **Judge 契约比表面更松。**
   `LLMJudge.score` 没有 0 到 1 validator。
   prompt 用标签包裹材料，但没有结构化抗 prompt injection 边界。
   进程级默认裁判模型还是可变全局。

7. **报告平均值会排除缺值和 Task failure。**
   每个 score key 有自己的有效 case 分母。
   单看 Averages 可能看不到最严重的 Task 错误。

8. **span 能力依赖 instrumentation 细节。**
   provider-native 工具不产生本地 span 时，agentic evaluator 看不到它。
   参数内容关闭后，`ArgumentCorrectness` 只能失败。
   这不是运行事实 receiver 的完整替代品。

9. **结果证据很薄。**
   `EvaluationReason` 只有自由文本。
   它没有结构化 observed value、证据完整度、event locator 或文件 locator。

10. **再次判分只有低层原语。**
    JSON report 不含 span tree。
    随包也没有 `EvaluatorContextSource` 实现。
    修改 rubric 后无法从 report artifact 一步生成同形新报告。

11. **文档和发布源码有可见漂移。**
    单输出 `LLMJudge` 名字、默认模型、嵌套 mapping 与 evaluator fail-fast 都有冲突。
    新手只看指南会写出错误预期。

12. **online 入口在基础安装下不可导入。**
    发布实现直接导入 `sniffio`，发布依赖却没有声明它。
    作者需要自行补装这个包，才能使用 online evaluator 与低层再次判分入口。

13. **它没有 NiceEval 的 scope 与 Verdict。**
    case context 不能选择 run、turn、command 或 Sandbox 范围。
    assertion 也没有 Severity、points、optional、strict mode 与四态折叠。
    因此不能把 `EvaluatorContext` 直接类比成 NiceEval assertion receiver。

`Python` evaluator 是明确的过时入口。
2.27.0 已因安全原因删除它；尝试导入会抛带迁移链接的 `ImportError`。
[删除说明 PR](https://github.com/pydantic/pydantic-ai/pull/2808)给出了背景。

## 11. 对 NiceEval 可吸收与不应复制

### 可吸收

1. **保留 evaluator spec 与版本。**
   每个 AssertionResult 都应能说明由哪份 recipe、哪个版本产生。
   这对 rubric 改动后的可比性很有价值。

2. **让一个检查返回具名的相关读数。**
   Pydantic Evals 的平面 mapping 适合共享一次昂贵计算。
   NiceEval 可吸收“单次求值、多个具名结果”，但要用穷尽类型而不是 scalar 猜类型。

3. **把 case 判断与 report 分析分层。**
   PR、ROC、KS 和混淆矩阵属于跨样本读模型。
   它们不应挤进单条 assertion，也不应默认变成 Verdict。

4. **为行为事实提供具名算法。**
   `TrajectoryMatch` 明示 exact、LCS F1 与 multiset F1。
   `ArgumentCorrectness` 明示顶层 subset、occurrence 与失败尝试。
   这种精确命名比泛称“trajectory correctness”更可靠。

5. **终端 diff 与 reason 同面。**
   参照报告、读数变化和失败说明可以使用同一报告入口。
   作者不用先切换到 web 才理解回归。

6. **自定义与内置共用一个结果协议。**
   第三方 Judge 或 metric 也回到标准结果。
   NiceEval 应继续避免每个 Adapter 发明独立 score 形状。

### 不应复制

1. 不用 `bool | number | string` 猜结果类别。
   NiceEval 还要表达 scope、Severity、证据可用性和 Verdict，显式联合更安全。

2. 不用空 mapping 同时表示不适用、证据不足和主动跳过。
   这些状态需要不同 reason 与聚合行为。

3. 不让“列表在前”暗示执行 gate。
   如果昂贵 Judge 依赖快检查通过，API 应显式声明依赖或阶段。

4. 不把缺 span 归成普通 `False` 或 0。
   instrumentation 不可用不是被测行为明确失败。

5. 不让 Averages 静默排除 Task failure。
   默认报告应同时显示有效分母、失败数和证据缺口。

6. 不把进程级可变默认模型当作实验身份。
   Judge model、settings、rubric 与输出 schema 都应进入稳定指纹。

7. 不把 report analysis 当作 CI gate。
   聚合门槛需要具名配置、缺值策略和明确 Verdict 影响。

## 12. 无法核实项

1. **逐 API 稳定度。**
   PyPI classifier 是 Production/Stable，但官方没有为每个 evaluator 标注稳定、实验性或兼容期限。
   本文只能确认 2.27.0 的公开导出与行为。

2. **`LLMJudge.score` 的实际范围。**
   指南说 0 到 1，源码没有 validator。
   未找到官方材料说明超出范围时下游应怎样处理。

3. **指南所说的嵌套 mapping。**
   Custom Evaluators 页面写 values 可含 nested dict。
   `EvaluatorOutput` 类型和运行时 TypeAdapter 只接受平面 mapping。
   本文按发布源码判为不支持。

4. **完整再次判分存储实现。**
   `EvaluatorContextSource` 是 protocol。
   官方包与文档没有给出一个可直接安装的实现，也没有从 JSON report 重建 span tree 的命令。

5. **Judge 与人类的一致性。**
   官方页面介绍 G-Eval 与 rubric recipe，但没有为 2.27.0 内置 prompt 提供独立 benchmark。
   本研究不推断相关性、偏差或跨模型稳定性。

6. **付费模型实跑。**
   研究没有使用真实 API key 调用 `LLMJudge` 或 `GEval`。
   签名、prompt、默认模型和错误语义来自固定源码，不包含模型质量验收。

7. **全部第三方 instrumentation。**
   span 事实会随被测库写出的 OTel 形状变化。
   本文只确认 Pydantic AI 2.27.0 的内置 agentic 提取规则，不推断其它 Agent 框架的兼容性。

8. **滚动文档修订时间。**
   页面没有与每段正文一一对应的 commit 标识。
   本文无法证明冲突文字会在哪个文档发布中修正。
