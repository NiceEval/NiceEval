# DeepEval 断言、Metric 与 Judge 作者面研究

> 观察日期：2026-08-09。本文以 DeepEval `4.1.5`、tag commit
> `0abedb84c7db59873125e3c8e66199fa874c4878` 为固定代码一手材料。
> 官网文档持续更新；当文档与该 commit 不同，本文以固定代码为准并单独提示。

## 1. 定位与真实边界

DeepEval 是 Python 的 LLM eval 框架。作者把一次观测写成 test case，把判分规则写成 metric，
再通过 `measure()`、`assert_test()`、`evaluate()`、Pytest 插件或 trace 运行这些规则。
其开源框架可本地运行，Confident AI 是可选的托管报告与协作服务。
[官方 FAQ](https://deepeval.com/docs/faq) 明确区分二者。

它的强项是把 LLM Judge、RAG、Agent、对话、MCP、安全和图像 metric 放进同一种运行协议。
核心对象会保存 `score`、`reason`、`success`、费用、token 和详细日志。
测试作者可以把有阈值的 metric 当作 CI 条件，也可以把阈值设为 `None`，只取分数。

它不是通用程序断言 DSL，也不负责创建 Sandbox、驱动命令、收集任意事件或管理资源生命周期。
`LLMTestCase` 主要承载模型输入输出及参照事实；trace metric 读取 DeepEval trace。
任意业务状态仍需作者先转换为这些公开对象，或自行实现 `BaseMetric`。

“所有 metric 都给 0 到 1”也不是完整事实。普通 metric 通常给 `float`，Arena Judge 返回胜者名，
`compare()` 返回各参赛者胜场。`Scorer.truth_identification_score()` 还返回 0 到 100 的百分值。
这些面不能共用一个数值判定假设。

## 2. 观察版本和一手链接

### 2.1 固定快照

| 项目 | 固定事实 | 一手材料 |
| --- | --- | --- |
| PyPI 版本 | `deepeval==4.1.5`；Python `>=3.9,<4.0` | [PyPI 4.1.5](https://pypi.org/project/deepeval/4.1.5/) |
| wheel | 2026-07-31 上传；SHA-256 `402f0a0b5968162a7b3af1fb99d443130626f27442b768e20ac93986188ae280` | [PyPI 文件元数据](https://pypi.org/pypi/deepeval/4.1.5/json) |
| sdist | 2026-07-31 上传；SHA-256 `064bffc288b899d3ac010e0b7c5eaaba11232e93140d8aeb988bd3f9bb09ee3e` | [PyPI 文件元数据](https://pypi.org/pypi/deepeval/4.1.5/json) |
| Git tag | `v4.1.5` 指向 `0abedb84c7db59873125e3c8e66199fa874c4878` | [固定源码树](https://github.com/confident-ai/deepeval/tree/0abedb84c7db59873125e3c8e66199fa874c4878) |
| 官网文档 | 滚动站点，不与 `4.1.5` tag 一一绑定 | [官方文档索引](https://deepeval.com/llms.txt) |

以下固定文件承担 API 核对职责。后文表格中的“固定源码”均指这一组 commit 链接。

| 作者面 | 固定源码 |
| --- | --- |
| 根 metric 导出 | [`metrics/__init__.py`](https://github.com/confident-ai/deepeval/blob/0abedb84c7db59873125e3c8e66199fa874c4878/deepeval/metrics/__init__.py) |
| metric 基类与共同状态 | [`metrics/base_metric.py`](https://github.com/confident-ai/deepeval/blob/0abedb84c7db59873125e3c8e66199fa874c4878/deepeval/metrics/base_metric.py) |
| 单轮 test case | [`test_case/llm_test_case.py`](https://github.com/confident-ai/deepeval/blob/0abedb84c7db59873125e3c8e66199fa874c4878/deepeval/test_case/llm_test_case.py) |
| 多轮 test case | [`test_case/conversational_test_case.py`](https://github.com/confident-ai/deepeval/blob/0abedb84c7db59873125e3c8e66199fa874c4878/deepeval/test_case/conversational_test_case.py) |
| Arena test case | [`test_case/arena_test_case.py`](https://github.com/confident-ai/deepeval/blob/0abedb84c7db59873125e3c8e66199fa874c4878/deepeval/test_case/arena_test_case.py) |
| `assert_test()`、`evaluate()` | [`evaluate/evaluate.py`](https://github.com/confident-ai/deepeval/blob/0abedb84c7db59873125e3c8e66199fa874c4878/deepeval/evaluate/evaluate.py) |
| 并发、展示、缓存、错误配置 | [`evaluate/configs.py`](https://github.com/confident-ai/deepeval/blob/0abedb84c7db59873125e3c8e66199fa874c4878/deepeval/evaluate/configs.py) |
| 返回对象 | [`evaluate/types.py`](https://github.com/confident-ai/deepeval/blob/0abedb84c7db59873125e3c8e66199fa874c4878/deepeval/evaluate/types.py)、[`tracing/api.py`](https://github.com/confident-ai/deepeval/blob/0abedb84c7db59873125e3c8e66199fa874c4878/deepeval/tracing/api.py) |
| GEval、DAG、Arena | [`g_eval.py`](https://github.com/confident-ai/deepeval/blob/0abedb84c7db59873125e3c8e66199fa874c4878/deepeval/metrics/g_eval/g_eval.py)、[`dag.py`](https://github.com/confident-ai/deepeval/blob/0abedb84c7db59873125e3c8e66199fa874c4878/deepeval/metrics/dag/dag.py)、[`arena_g_eval.py`](https://github.com/confident-ai/deepeval/blob/0abedb84c7db59873125e3c8e66199fa874c4878/deepeval/metrics/arena_g_eval/arena_g_eval.py) |
| DAG 节点与序列化 | [`dag/nodes.py`](https://github.com/confident-ai/deepeval/blob/0abedb84c7db59873125e3c8e66199fa874c4878/deepeval/metrics/dag/nodes.py)、[`dag/serialization/serialization.py`](https://github.com/confident-ai/deepeval/blob/0abedb84c7db59873125e3c8e66199fa874c4878/deepeval/metrics/dag/serialization/serialization.py) |
| Arena 聚合入口 | [`evaluate/compare.py`](https://github.com/confident-ai/deepeval/blob/0abedb84c7db59873125e3c8e66199fa874c4878/deepeval/evaluate/compare.py) |
| 传统 scorer | [`scorer/scorer.py`](https://github.com/confident-ai/deepeval/blob/0abedb84c7db59873125e3c8e66199fa874c4878/deepeval/scorer/scorer.py) |
| RAGAS 适配层 | [`metrics/ragas.py`](https://github.com/confident-ai/deepeval/blob/0abedb84c7db59873125e3c8e66199fa874c4878/deepeval/metrics/ragas.py) |

### 2.2 读法

“官方事实”来自固定源码、PyPI 或官网 API 文档。“研究判断”是本文依据这些事实做的 DX 分析。
滚动文档的示例若无法在固定签名中成立，会进入第 12 节，而不会反向改写固定事实。

## 3. 安装、最小项目和首个可运行 eval

### 3.1 安装

创建满足 Python `>=3.9,<4.0` 的虚拟目录，并固定版本：

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install "deepeval==4.1.5"
```

确定性 metric 不需要模型密钥。大多数 Judge metric 在未传 `model` 时使用 OpenAI，
固定源码的默认模型名为 `gpt-5.4`。
可设置 `OPENAI_API_KEY`，也可按[自定义 Judge 模型](https://deepeval.com/docs/metrics-introduction#using-a-custom-llm)
传入 `DeepEvalBaseLLM`。

### 3.2 最小项目

```text
deepeval-demo/
├── .venv/
└── test_answer.py
```

把下列内容保存为 `test_answer.py`。它只用确定性 `ExactMatchMetric`，可直接执行。

```python
from deepeval import assert_test
from deepeval.metrics import ExactMatchMetric
from deepeval.test_case import LLMTestCase


def test_capital() -> None:
    case = LLMTestCase(
        input="What is the capital of France?",
        actual_output="Paris",
        expected_output="Paris",
    )
    assert_test(case, [ExactMatchMetric()])
```

运行官方 CLI，而不是直接调用 `pytest`：

```bash
deepeval test run test_answer.py
```

官方[五分钟入门](https://deepeval.com/docs/getting-started)使用相同的 test case、metric、
`assert_test()` 与 CLI 形状。CLI 让 DeepEval 插件接管并发、缓存、显示和可选上传。

### 3.3 首次失败长什么样

把 `actual_output` 改成 `Lyon` 后，`assert_test()` 抛出 `AssertionError`。
消息包含 metric 名、分数、阈值、严格模式、错误与 `reason`。
`ExactMatchMetric` 去除两端空白后做精确比较，匹配为 `1`，否则为 `0`；默认阈值是 `1`。
[固定实现](https://github.com/confident-ai/deepeval/blob/0abedb84c7db59873125e3c8e66199fa874c4878/deepeval/metrics/exact_match/exact_match.py)
给出了这些语义。

## 4. 核心数据流与对象关系

```text
应用输出 / 参照事实 / trace
            │
            ▼
LLMTestCase | ConversationalTestCase | ArenaTestCase | Golden
            │
            ▼
BaseMetric | BaseConversationalMetric | BaseArenaMetric
 measure() / a_measure()
            │
            ├── score、reason、success、error
            ├── verbose_logs、费用、token
            └── Arena winner
            │
            ▼
assert_test() | evaluate() | compare() | evals_iterator() | observe
            │
            ▼
AssertionError | EvaluationResult | 胜场字典 | JSON artifact | 可选云端 Run
```

普通 metric 是有状态对象。一次 `measure(test_case)` 返回分数，同时写入该实例的 `score`、
`reason`、`success`、`error` 和诊断字段。`a_measure()` 是可等待版本。
研究判断：手工并发时不要让多个协程共享同一个 metric 实例；runner 会管理自己的执行副本。

`async_mode=True` 不会把同步 `measure()` 变成可等待函数。它允许 `measure()` 内部并发请求，
但调用者仍被阻塞。应用已有事件循环时，应直接 `await metric.a_measure(case)`。
[基类](https://github.com/confident-ai/deepeval/blob/0abedb84c7db59873125e3c8e66199fa874c4878/deepeval/metrics/base_metric.py)
和各 metric 实现共同证明这个区分。

普通 test case 的最终通过状态是所有“有阈值且非 flaky”的 metric 都成功。
DeepEval 不提供权重、总分、points 或布尔公式聚合。作者要表达分支规则时用 DAG；
要表达总分时实现自定义 metric；要比较回答时用 Arena。

## 5. 完整 API catalog

### 5.1 Test case 与输入对象

下表来自固定的[单轮](https://github.com/confident-ai/deepeval/blob/0abedb84c7db59873125e3c8e66199fa874c4878/deepeval/test_case/llm_test_case.py)、
[多轮](https://github.com/confident-ai/deepeval/blob/0abedb84c7db59873125e3c8e66199fa874c4878/deepeval/test_case/conversational_test_case.py)、
[Arena](https://github.com/confident-ai/deepeval/blob/0abedb84c7db59873125e3c8e66199fa874c4878/deepeval/test_case/arena_test_case.py)
模型。

| API | 签名、默认值与约束 | 消费方式 |
| --- | --- | --- |
| `LLMTestCase` | `input: str` 必填。`actual_output`、`expected_output`、`context`、`retrieval_context`、`metadata`、`tools_called`、`expected_tools`、`comments`、`token_cost`、`completion_time`、`name`、`tags`、MCP 字段、`custom_column_key_values` 默认 `None`；`flaky=False`，`multimodal=False` | 单轮和图像 metric；缺失字段由 metric 在运行时拒绝 |
| `ConversationalTestCase` | `turns: list[Turn]` 必填且非空。`scenario`、`context`、`name`、`user_description`、`expected_outcome`、`chatbot_role`、`metadata`、`comments`、`tags`、`mcp_servers` 默认 `None`；`flaky=False` | 多轮 metric；整个会话得到一组 metric 结果 |
| `Turn` | `role: Literal["user", "assistant"]`、`content: str` 必填；`user_id`、`retrieval_context`、`tools_called`、MCP 调用字段、`metadata` 默认 `None` | 放入 `ConversationalTestCase.turns` |
| `Contestant` | `name: str`、`test_case: LLMTestCase` 必填；`hyperparameters=None` | 放入 Arena test case |
| `ArenaTestCase` | `contestants: list[Contestant]` 必填且实际须非空；名称唯一；各参赛者的 `input` 与 `expected_output` 必须相同 | `ArenaGEval.measure()` 或 `compare()` |
| `ToolCall` | `name` 必填；`type=FUNCTION`；`description`、`reasoning`、`output`、`input_parameters` 默认 `None` | Agent、工具正确性和对话工具 metric |
| `RetrievedContextData` | `context: str`、`source: str` 必填 | 可替代 `retrieval_context` 中的纯字符串 |
| `MLLMImage` | `url` 或 `dataBase64` 加 `mimeType` 必须提供；`local`、`filename` 可省略 | 通过字符串插值放进 `input` 或 `actual_output` |
| MCP 对象 | `MCPToolCall(name,args,result)`、`MCPPromptCall(name,result)`、`MCPResourceCall(uri,result)`；`MCPServer(server_name,transport,available_tools,available_resources,available_prompts)` | MCP metric；结果类型来自官方 `mcp` 包 |

`SingleTurnParams` 枚举可选择：

- `INPUT`、`ACTUAL_OUTPUT`、`EXPECTED_OUTPUT`、`CONTEXT`、`RETRIEVAL_CONTEXT`；
- `METADATA`、`TAGS`、`TOOLS_CALLED`、`EXPECTED_TOOLS`；
- `MCP_SERVERS`、`MCP_TOOLS_CALLED`、`MCP_RESOURCES_CALLED`、`MCP_PROMPTS_CALLED`。

`MultiTurnParams` 可选择：

- `ROLE`、`CONTENT`、`METADATA`、`TAGS`、`SCENARIO`、`EXPECTED_OUTCOME`、`CONTEXT`；
- `USER_DESCRIPTION`、`RETRIEVAL_CONTEXT`、`CHATBOT_ROLE`、`TOOLS_CALLED`；
- `MCP_TOOLS`、`MCP_RESOURCES`、`MCP_PROMPTS`。

`ToolCallParams` 只有 `INPUT_PARAMETERS` 与 `OUTPUT`。
`LLMTestCaseParams`、`TurnParams` 和 `additional_metadata` 是过时别名；
4.1.5 会发出 `DeprecationWarning`。新代码应使用 `SingleTurnParams`、`MultiTurnParams` 和 `metadata`。

`ToolCall` 相等只比较 `name`、`input_parameters` 与 `output`。
`description`、`reasoning` 和 `type` 不参与相等判断；这会直接影响工具正确性 metric 的参照匹配。

### 5.2 断言、批量运行与 Arena 聚合

#### `assert_test()`

```text
assert_test(
    test_case: LLMTestCase | ConversationalTestCase | None = None,
    metrics: list[BaseMetric] | list[BaseConversationalMetric] | None = None,
    golden: Golden | None = None,
    run_async: bool = True,
) -> None
```

直接模式传 `test_case` 与 `metrics`。trace 模式在活跃 trace 中传 `golden`。
`run_async=True` 让多个 metric 并发，但函数本身同步返回。
至少一个 metric 必须“有阈值且非 flaky”；全部是 score-only 或 flaky 会在运行前报错。

`LLMTestCase` 只能配 `BaseMetric`，`ConversationalTestCase` 只能配 `BaseConversationalMetric`。
该函数不接受配置对象；CLI 或进程级设置决定缓存、忽略错误、缺字段跳过与详细模式。

失败时抛 `AssertionError`。如果 test case 自身 `flaky=True`，失败只发 warning。
metric 自身 `flaky=True` 时仍计算分数、理由和 Verdict，但不会使 test case 失败。
[固定实现](https://github.com/confident-ai/deepeval/blob/0abedb84c7db59873125e3c8e66199fa874c4878/deepeval/evaluate/evaluate.py)
与[官方 metric 介绍](https://deepeval.com/docs/metrics-introduction)一致。

#### `evaluate()`

```text
evaluate(
    test_cases: list[LLMTestCase] | list[ConversationalTestCase],
    metrics: list[BaseMetric] | list[BaseConversationalMetric] | None = None,
    metric_collection: str | None = None,
    hyperparameters: dict | None = None,
    identifier: str | None = None,
    official: bool = False,
    async_config: AsyncConfig = AsyncConfig(),
    display_config: DisplayConfig = DisplayConfig(),
    cache_config: CacheConfig = CacheConfig(),
    error_config: ErrorConfig = ErrorConfig(),
) -> EvaluationResult
```

`metrics` 是本地 metric 列表；`metric_collection` 是 Confident AI 中的集合名，二者择一。
`hyperparameters` 接受字符串、整数、浮点数或 `Prompt`。`identifier` 标识该次 Run。
`official=True` 创建云端官方对照 Run，需要登录信息；普通本地执行保持 `False`。
固定函数另有 `_skip_reset=False`，它是 runner 内部参数，不属于公开作者面。

返回 `EvaluationResult(test_results, confident_link, test_run_id)`。
同步函数按 `AsyncConfig.run_async` 选择内部并发或串行路径。
它同样要求至少一个有阈值且非 flaky 的 metric。
[官方运行说明](https://deepeval.com/docs/evaluation-introduction)与固定源码列出这些公开参数。

一个 Run 不能混用单轮与多轮 test case；metric 基类也必须与 test case 类型一致。

#### `compare()`

```text
compare(
    test_cases: list[ArenaTestCase],
    metric: ArenaGEval,
    name: str = "compare()",
    async_config: AsyncConfig = AsyncConfig(),
    display_config: DisplayConfig = DisplayConfig(),
    error_config: ErrorConfig = ErrorConfig(),
) -> dict[str, int]
```

每个 Arena test case 产生一个胜者名。返回字典按参赛者累计胜场；零胜场名称不会自动出现。
它没有阈值、通过状态或平局值。
Judge 失败默认中止；`ErrorConfig(ignore_errors=True)` 会继续处理其余 test case。
固定 [`compare.py`](https://github.com/confident-ai/deepeval/blob/0abedb84c7db59873125e3c8e66199fa874c4878/deepeval/evaluate/compare.py)
是 4.1.5 签名真源。

### 5.3 Metric 的共同协议

以下“J 配置”简写只用于本节表格，不是 DeepEval API：

```text
threshold: float | None = 0.5
model: str | DeepEvalBaseLLM | None = None
include_reason: bool = True
async_mode: bool = True
strict_mode: bool = False
verbose_mode: bool = False
flaky: bool = False
```

除表格明示差异外，Judge metric 接受 J 配置，并提供：

```text
metric.measure(test_case) -> float
await metric.a_measure(test_case) -> float
metric.is_successful() -> bool | None
```

运行后读取 `score`、`reason`、`success`、`evaluation_model`、`error`、`evaluation_cost`、
`input_tokens`、`output_tokens` 与 `verbose_logs`。
`include_reason=False` 省掉理由生成步骤；`verbose_mode=True` 生成并显示中间步骤，
不只是把最终 `reason` 打印得更长。

默认判定是 `score >= threshold`。`BiasMetric`、`ToxicityMetric`、
`HallucinationMetric` 与 `MisuseMetric` 是分数越低越好，使用 `score <= threshold`。
多数普通 metric 的严格模式把阈值设为 `1`，并把非满分结果变成 `0`。
这四个反向 metric 把阈值设为 `0`，并把不合格结果变成 `1`。
[固定实现集合](https://github.com/confident-ai/deepeval/tree/0abedb84c7db59873125e3c8e66199fa874c4878/deepeval/metrics)
明确写出各自的 `is_successful()`。`RoleViolationMetric` 有一处不一致，见对应表格与第 10 节。

`threshold=None` 是 score-only。此时 `score` 与 `reason` 仍会产生，`success=None`，
该 metric 不参与 test case 的最终状态。score-only 不是跳过，也不是自动成功。
`strict_mode=True` 会改写阈值，因此与 `threshold=None` 同传时，严格模式优先。此时不是 score-only。

缺少必需 test case 字段时，默认抛错。`ErrorConfig(skip_on_missing_params=True)` 会把该 metric 标成跳过，
并从 `metrics_data` 移除；`ignore_errors=True` 则保留一条 `error`，分数为 `None`，成功为 `False`。
两项都开时，缺字段跳过优先。[官方配置说明](https://deepeval.com/docs/evaluation-flags-and-configs)
证实优先级。

一个边缘语义来自固定 runner：若某个 test case 的所有 metric 都因缺字段而跳过，
该 test case 会保持初始 `success=True`。研究判断：CI 不应把“没有 metric 结果”当作合格证据；
调用方应额外要求 `metrics_data` 非空且包含预期名称。

### 5.4 GEval、DAG 与 Arena Judge

#### `GEval`

```text
GEval(
    name: str,
    evaluation_params: list[SingleTurnParams] | None = None,
    criteria: str | None = None,
    evaluation_steps: list[str] | None = None,
    rubric: list[Rubric] | None = None,
    model: str | DeepEvalBaseLLM | None = None,
    threshold: float | None = 0.5,
    top_logprobs: int = 20,
    async_mode: bool = True,
    strict_mode: bool = False,
    verbose_mode: bool = False,
    flaky: bool = False,
)
```

4.1.5 实际要求 `evaluation_params` 非空，并要求 `criteria` 与 `evaluation_steps` 恰好提供一个。
`Rubric(score_range: tuple[int, int], expected_outcome: str)` 的区间位于 0 到 10，且不能相交。
Judge 的原始 0 到 10 分会归一为 0 到 1；`measure()` 与 `a_measure()` 返回归一分数。

`top_logprobs=20` 用于原生 Judge 的概率加权。自定义模型未必能提供相同归一行为。
GEval 总会生成理由，构造函数没有 `include_reason`。它不是确定性 metric；
[官方 GEval 文档](https://deepeval.com/docs/metrics-llm-evals)明确提醒这一点。

`upload()` 把定义上传到 Confident AI，`pull()` 按名称取回定义；二者需要平台访问配置。
固定 [`g_eval.py`](https://github.com/confident-ai/deepeval/blob/0abedb84c7db59873125e3c8e66199fa874c4878/deepeval/metrics/g_eval/g_eval.py)
给出签名与返回状态。

GEval、DAG 与 Arena 构造函数还有控制名称后缀的 `_include_*_suffix` 参数。
这些下划线参数用于框架内部复制与显示，本文不把它们列为稳定作者配置。

#### `ConversationalGEval`

签名与 `GEval` 相近，但 `evaluation_params` 使用 `MultiTurnParams`，输入是
`ConversationalTestCase`。`measure()` 与 `a_measure()` 返回 0 到 1。
4.1.5 在测量时仍要求显式参数；本文示例提供 `ROLE` 与 `CONTENT`。
[官方文档](https://deepeval.com/docs/metrics-conversational-g-eval)与
[固定源码](https://github.com/confident-ai/deepeval/blob/0abedb84c7db59873125e3c8e66199fa874c4878/deepeval/metrics/conversational_g_eval/conversational_g_eval.py)
存在第 12 节列出的差异。

它也提供 `upload()` 与 `pull()`。阈值、严格、flaky、同步、异步和 score-only 语义沿用共同协议。
构造函数会把缺少的 `ROLE` 与 `CONTENT` 追加到调用方传入的参数列表；该列表会被原地修改。

#### `DAGMetric` 与 `ConversationalDAGMetric`

```text
DAGMetric(
    name: str,
    dag: DeepAcyclicGraph,
    model=None,
    threshold: float | None = 0.5,
    include_reason: bool = True,
    async_mode: bool = True,
    strict_mode: bool = False,
    verbose_mode: bool = False,
    flaky: bool = False,
)
```

`ConversationalDAGMetric` 使用同一配置与多轮图。直接末端的整数 `score` 位于 0 至 10，
metric 会除以 10。末端若委托子 metric，则直接采用子 metric 的分数与理由。
分支选择由 Judge 完成；末端分值映射是作者定义的确定规则。
[单轮 DAG](https://deepeval.com/docs/metrics-dag)与[多轮 DAG](https://deepeval.com/docs/metrics-conversational-dag)
说明用途，固定源码定义实际签名。

`DeepAcyclicGraph(root_nodes)` 要求非空根节点，并拒绝环与非法分支。
它提供 `to_dict()`、`to_json(indent=2)`、
`from_dict(data, multiturn=False)` 和 `from_json(text, multiturn=False)`。
模块还导出 `dag_to_dict`、`dag_to_json`、`dag_from_dict`、`dag_from_json`。

单轮节点 API 如下，多轮节点把类名前加 `Conversational`，并把参数枚举换成 `MultiTurnParams`。
多轮节点还接受 `turn_window: tuple[int, int] | None`；该二元组两端都计入。

| 节点 | 4.1.5 构造与返回关系 |
| --- | --- |
| `TaskNode` | `(instructions, output_label, children=[], evaluation_params=None, label=None)`；`add_node(child)` 返回 child |
| `BinaryJudgementNode` | `(criteria, children=[], evaluation_params=None, label=None)`；`add_verdict(bool, score=None, then=None)` |
| `NonBinaryJudgementNode` | 同上；`add_verdict(str, score=None, then=None)` |
| `VerdictNode` | `(verdict: Union[str, bool], score: Optional[int]=None, child=None)`；`score` 与 `child` 恰好一个 |

`score` 必须位于 0 到 10。二元判断必须同时具有 `True` 与 `False`；非二元 verdict 文本必须唯一。
构造函数中的 `children` 属于仍可运行的旧式自底向上形状，会发弃用提示。
新代码使用 `add_node()` 与 `add_verdict()` 自顶向下建图。

子 metric 的原始分数会直接成为 DAG 分数，DAG 自身仍按“越高越好”比较阈值。
因此不能直接委托 Bias、Toxicity、Hallucination 或 Misuse，再期待保留其“越低越好”的方向。
[固定 runner](https://github.com/confident-ai/deepeval/blob/0abedb84c7db59873125e3c8e66199fa874c4878/deepeval/metrics/dag/runner.py)
展示了这次直接赋值。

DAG metric 也有 `upload()` 与 `pull()`。图的 JSON 可本地保存；平台方法另需登录信息。

#### `ArenaGEval`

```text
ArenaGEval(
    name: str,
    evaluation_params: list[SingleTurnParams],
    criteria: str | None = None,
    evaluation_steps: list[str] | None = None,
    model=None,
    async_mode: bool = True,
    verbose_mode: bool = False,
)
```

`criteria` 与 `evaluation_steps` 恰好一个。`measure(ArenaTestCase)` 和 `a_measure()` 返回参赛者名称，
并写 `reason`；没有分数、阈值、strict、flaky、score-only 或 `is_successful()`。
`compare()` 才负责多题胜场相加。[官方 Arena 文档](https://deepeval.com/docs/metrics-arena-g-eval)
和固定源码共同界定这个面。

### 5.5 根模块导出的 built-in metric

以下各表穷尽 4.1.5 `deepeval.metrics.__all__` 中的具体 metric。
每个 Judge metric 都返回 0 到 1，并沿用 J 配置、同步、异步、错误、跳过、flaky 与 score-only 语义。
表内只写必需 test case 字段和构造差异；“无”表示没有超出 J 配置的作者参数。

#### 确定性与结构 metric

[官方非 Judge 说明](https://deepeval.com/docs/metrics-introduction#what-about-non-llm-as-a-judge-metrics)
和固定的[根导出](https://github.com/confident-ai/deepeval/blob/0abedb84c7db59873125e3c8e66199fa874c4878/deepeval/metrics/__init__.py)
给出这组入口。

| API | 构造差异 | 必需字段 | 分数、理由与异步 |
| --- | --- | --- | --- |
| [`ExactMatchMetric`](https://deepeval.com/docs/metrics-exact-match) | `threshold=1, verbose_mode=False, flaky=False` | `input, actual_output, expected_output` | 去除两端空白后精确比较，返回 1 或 0；固定理由；`a_measure()` 调同步实现 |
| [`PatternMatchMetric`](https://deepeval.com/docs/metrics-pattern-match) | `pattern` 必填；`ignore_case=False, threshold=1, verbose_mode=False, flaky=False` | `input, actual_output` | 对去除两端空白的全文做正则 `fullmatch`；返回 1 或 0；非法正则在构造时抛 `ValueError` |
| [`JsonCorrectnessMetric`](https://deepeval.com/docs/metrics-json-correctness) | `expected_schema: BaseModel` 必填，调用时传 Pydantic model class；J 配置中 `strict_mode=True` | `input, actual_output` | Pydantic 校验 JSON，返回 1 或 0；模型只用于失败理由；默认阈值实际为 1 |
| [`ToolPermissionMetric`](https://deepeval.com/docs/metrics-tool-permission) | `allowed_tools`、`denied_tools` 至少一个；`threshold=1, include_reason=True, strict_mode=False, verbose_mode=False, flaky=False` | `tools_called` | 授权调用数除以总调用数；无调用为 1；拒绝名单优先；`a_measure()` 调同步实现 |
| [`AgentLoopDetectionMetric`](https://deepeval.com/docs/metrics-agent-loop-detection) | `threshold=.5, repetition_threshold=3, similarity_threshold=.85`；三个 `check_*` 均为 `True`；其余沿用 J 配置但没有 `model` | `input, actual_output` 与 trace | 确定性合并工具重复、推理停滞、调用图循环；返回 0 到 1 和 `score_breakdown`；没有 trace 时返回 0 |

`ToolPermissionMetric` 与 `AgentLoopDetectionMetric` 的官网页面位于 Community 分类，
但 4.1.5 已从根模块导出。研究判断：分类名不能当作稳定性保证；升级时仍应核对 tag。

#### RAG metric

官方 RAG 页面分别给出[答案相关性](https://deepeval.com/docs/metrics-answer-relevancy)、
[忠实度](https://deepeval.com/docs/metrics-faithfulness)、
[上下文精度](https://deepeval.com/docs/metrics-contextual-precision)、
[上下文召回](https://deepeval.com/docs/metrics-contextual-recall)与
[上下文相关性](https://deepeval.com/docs/metrics-contextual-relevancy)。

| API | 构造差异 | 必需字段 | 直接含义 |
| --- | --- | --- | --- |
| `AnswerRelevancyMetric` | 无 | `input, actual_output` | 回答中与问题相关的陈述比例 |
| `FaithfulnessMetric` | `truths_extraction_limit=None, penalize_ambiguous_claims=False` | `input, actual_output, retrieval_context` | 可由检索上下文支持的回答 claim 比例 |
| `ContextualPrecisionMetric` | 无 | `input, retrieval_context, expected_output` | 相关检索项在排序中的前置程度 |
| `ContextualRecallMetric` | 无 | `input, retrieval_context, expected_output` | 参照回答中可归因于检索上下文的 claim 比例 |
| `ContextualRelevancyMetric` | 无 | `input, retrieval_context` | 检索上下文中相关陈述比例 |

#### 内容质量与安全 metric

这一组的官网一手材料是[幻觉](https://deepeval.com/docs/metrics-hallucination)、
[偏见](https://deepeval.com/docs/metrics-bias)、[毒性](https://deepeval.com/docs/metrics-toxicity)、
[PII 泄漏](https://deepeval.com/docs/metrics-pii-leakage)、[非建议](https://deepeval.com/docs/metrics-non-advice)、
[滥用](https://deepeval.com/docs/metrics-misuse)和[角色违规](https://deepeval.com/docs/metrics-role-violation)。

| API | 构造差异 | 必需字段 | 方向与含义 |
| --- | --- | --- | --- |
| `HallucinationMetric` | 无 | `input, actual_output, context` | 越低越好；与给定 `context` 冲突的比例 |
| `BiasMetric` | 无 | `input, actual_output` | 越低越好；有偏见意见的比例 |
| `ToxicityMetric` | 无 | `input, actual_output` | 越低越好；有毒意见的比例 |
| `PIILeakageMetric` | 无 | `input, actual_output` | 越高越好；输出避免泄漏 PII 的程度 |
| `NonAdviceMetric` | `advice_types: list[str]` 必填 | `input, actual_output` | 越高越好；输出避免指定类型建议的程度 |
| `MisuseMetric` | `domain: str` 必填 | `input, actual_output` | 越低越好；输出协助滥用指定领域知识的程度 |
| `RoleViolationMetric` | `role: Optional[str]=None`，但 `None` 会在构造时抛 `ValueError` | `input, actual_output` | 二元分数；无违规为 1。4.1.5 的严格模式把阈值设为 0，因而不能表达“只允许无违规” |

#### 单轮通用与任务 metric

官网分别说明[摘要](https://deepeval.com/docs/metrics-summarization)、
[提示对齐](https://deepeval.com/docs/metrics-prompt-alignment)、
[工具正确性](https://deepeval.com/docs/metrics-tool-correctness)与
[参数正确性](https://deepeval.com/docs/metrics-argument-correctness)。

| API | 构造差异 | 必需字段 | 直接含义 |
| --- | --- | --- | --- |
| `SummarizationMetric` | `n=5, assessment_questions=None, truths_extraction_limit=None`，其余沿用 J 配置 | `input, actual_output` | 对齐度与信息完整度的较小值；`assessment_questions` 可固定问题 |
| `PromptAlignmentMetric` | `prompt_instructions: list[str]` 必填 | `input, actual_output` | 输出遵守每条提示指令的比例 |
| `ToolCorrectnessMetric` | `available_tools=None, evaluation_params=[]`；`should_exact_match=False, should_consider_ordering=False`；其余沿用 J 配置 | `input, tools_called, expected_tools` | 比较工具名称；可用 `ToolCallParams` 再比较参数与输出；可要求精确集合及顺序 |
| `ArgumentCorrectnessMetric` | 无 | `input, tools_called` | Judge 判断每个工具调用参数是否正确 |

`ToolCorrectnessMetric.evaluation_params` 的固定默认值是空列表。
研究判断：作者应显式传新列表，不要把这个可变默认对象当作共享配置容器。

#### Trace-only Agent metric

官方把[任务完成](https://deepeval.com/docs/metrics-task-completion)、
[步骤效率](https://deepeval.com/docs/metrics-step-efficiency)、
[计划遵守](https://deepeval.com/docs/metrics-plan-adherence)与
[计划质量](https://deepeval.com/docs/metrics-plan-quality)定义为 Agent trace metric。

| API | 构造差异 | 必需字段 | Trace 判分对象 |
| --- | --- | --- | --- |
| `TaskCompletionMetric` | `task: Optional[str]=None`，其余沿用 J 配置 | `input, actual_output` 与 trace | 从 trace 提取任务与结果；`task` 可显式提供任务 |
| `StepEfficiencyMetric` | 无 | `input, actual_output` 与 trace | 依据完成任务所需步骤判断效率 |
| `PlanAdherenceMetric` | 无 | `input, actual_output` 与 trace | 比较执行路径与 trace 中的计划 |
| `PlanQualityMetric` | 无 | `input, actual_output` 与 trace | 判断计划能否有效完成任务；没有可提取计划时官方规则给 1 |

这些类都把 `requires_trace=True` 写入固定源码。标准作者路径是 `EvaluationDataset.evals_iterator()`
或 `@observe`。`TaskCompletionMetric` 有一个按输入、输出和工具调用求值的兼容分支，
源码注释准备弃用它。其余 trace 事实仍不能由普通 test case 字段替代。

#### 多轮对话 metric

下表对应官方的[多轮 metric 分类](https://deepeval.com/docs/evaluation-multiturn-test-cases)。
所有类输入 `ConversationalTestCase`，必需字段均按固定源码列出。

| API | 构造差异 | 必需字段 | 直接含义 |
| --- | --- | --- | --- |
| [`TurnRelevancyMetric`](https://deepeval.com/docs/metrics-turn-relevancy) | `window_size=10, template_class=None`，其余沿用 J 配置 | `role, content` | 各 assistant turn 对邻近对话的相关性 |
| [`RoleAdherenceMetric`](https://deepeval.com/docs/metrics-role-adherence) | 无 | `role, content` | assistant 全程遵守指定角色的程度 |
| [`KnowledgeRetentionMetric`](https://deepeval.com/docs/metrics-knowledge-retention) | 无 | `role, content` | 对话保留先前用户事实的程度 |
| [`ConversationCompletenessMetric`](https://deepeval.com/docs/metrics-conversation-completeness) | `window_size=3`，其余沿用 J 配置 | `role, content` | 用户意图在整个会话中得到满足的比例 |
| [`GoalAccuracyMetric`](https://deepeval.com/docs/metrics-goal-accuracy) | 无 | `role, content` | 会话是否达到目标 |
| [`ToolUseMetric`](https://deepeval.com/docs/metrics-tool-use) | `available_tools: list[ToolCall]` 必填 | `role, content` | 多轮工具选择、参数和调用顺序 |
| [`TopicAdherenceMetric`](https://deepeval.com/docs/metrics-topic-adherence) | `relevant_topics: list[str]` 必填 | `role, content` | 会话停留在许可主题内的程度 |
| [`TurnFaithfulnessMetric`](https://deepeval.com/docs/metrics-turn-faithfulness) | `truths_extraction_limit=None, penalize_ambiguous_claims=False, window_size=10` | `role, content, retrieval_context` | 每轮回答受该轮检索上下文支持的程度 |
| [`TurnContextualPrecisionMetric`](https://deepeval.com/docs/metrics-turn-contextual-precision) | `window_size=10`，其余沿用 J 配置 | `role, content, retrieval_context, expected_outcome` | 多轮检索排序精度 |
| [`TurnContextualRecallMetric`](https://deepeval.com/docs/metrics-turn-contextual-recall) | `window_size=10`，其余沿用 J 配置 | `role, content, retrieval_context, expected_outcome` | 多轮检索召回程度 |
| [`TurnContextualRelevancyMetric`](https://deepeval.com/docs/metrics-turn-contextual-relevancy) | `window_size=10`，其余沿用 J 配置 | `role, content, retrieval_context` | 多轮检索相关性 |

表中 `window_size` 是官方 API 名，表示每次判分使用的邻近 turn 数。
它不是会话级统一切片；各 metric 的固定实现决定如何选取 turn。

#### MCP metric

官方分别说明[单轮 MCP 使用](https://deepeval.com/docs/metrics-mcp-use)、
[多轮 MCP 使用](https://deepeval.com/docs/metrics-multi-turn-mcp-use)和
[MCP 任务完成](https://deepeval.com/docs/metrics-mcp-task-completion)。

| API | 构造差异 | 必需字段 | 直接含义 |
| --- | --- | --- | --- |
| `MCPUseMetric` | J 配置；参数顺序把 `strict_mode` 放在 `async_mode` 前 | `input, actual_output, mcp_servers` 与 MCP 调用字段 | 单轮 MCP server、tool、resource、prompt 的使用质量 |
| `MultiTurnMCPUseMetric` | 无 | `role, content` 与 turn 中 MCP 调用字段 | 整段对话是否正确使用 MCP 能力 |
| `MCPTaskCompletionMetric` | 无 | `role, content` 与 turn 中 MCP 调用字段 | MCP 交互是否完成用户任务 |

MCP 调用对象会校验 `mcp.types` 的结果类。只有名字和任意字典不能替代
`CallToolResult`、`ReadResourceResult` 或 `GetPromptResult`。

#### 图像 metric

五个类均从根模块导出。官网一手材料是[图像一致性](https://deepeval.com/docs/multimodal-metrics-image-coherence)、
[图像帮助度](https://deepeval.com/docs/multimodal-metrics-image-helpfulness)、
[图像参照](https://deepeval.com/docs/multimodal-metrics-image-reference)、
[文生图](https://deepeval.com/docs/multimodal-metrics-text-to-image)与
[图像编辑](https://deepeval.com/docs/multimodal-metrics-image-editing)。

这组构造共同接受 `model=None, threshold=.5, async_mode=True, strict_mode=False,
verbose_mode=False, flaky=False`。它们没有 `include_reason` 参数，但会产生理由。

| API | 必需字段与图像数量 | 特有参数 | 直接含义 |
| --- | --- | --- | --- |
| `TextToImageMetric` | `input, actual_output`；输入 0 张图，输出恰好 1 张 | 无 | 文本提示与生成图像的对齐质量 |
| `ImageEditingMetric` | `input, actual_output`；输入与输出各恰好 1 张图 | 无 | 编辑指令、原图与结果图的对齐质量 |
| `ImageCoherenceMetric` | `input, actual_output`，并含图像 | `max_context_size=None` | 输出中图像与相邻文本的一致性 |
| `ImageHelpfulnessMetric` | `input, actual_output`，并含图像 | `max_context_size=None` | 图像是否帮助回答用户问题 |
| `ImageReferenceMetric` | `input, actual_output`，并含图像 | `max_context_size=None` | 文本对图像的指代是否正确 |

### 5.6 子模块 API：RAGAS 与 Community

这些类不在 4.1.5 根 `__all__` 中，但官方文档将其作为可用 metric，故不能从作者面省略。

#### RAGAS 适配层

[官方 RAGAS 页面](https://deepeval.com/docs/metrics-ragas)对应固定
[`metrics/ragas.py`](https://github.com/confident-ai/deepeval/blob/0abedb84c7db59873125e3c8e66199fa874c4878/deepeval/metrics/ragas.py)。
作者从 `deepeval.metrics.ragas` 导入，并另装 `ragas`、`datasets` 与 `langchain_core`。

| API | 构造签名 | 必需字段与返回 |
| --- | --- | --- |
| `RAGASContextualPrecisionMetric` | `(threshold=.3, model="gpt-3.5-turbo", _track=True)` | `input, expected_output, retrieval_context`；返回 0 到 1 |
| `RAGASContextualRecallMetric` | `(threshold=.3, model="gpt-3.5-turbo", _track=True)` | `input, expected_output, retrieval_context`；返回 0 到 1 |
| `RAGASContextualEntitiesRecall` | `(threshold=.3, model="gpt-3.5-turbo", _track=True)` | `expected_output, retrieval_context`；返回 0 到 1 |
| `RAGASAnswerRelevancyMetric` | `(threshold=.3, model="gpt-3.5-turbo", embeddings=None, _track=True)` | `input, actual_output, retrieval_context`；返回 0 到 1 |
| `RAGASFaithfulnessMetric` | `(threshold=.3, model="gpt-3.5-turbo", _track=True)` | `input, actual_output, retrieval_context`；返回 0 到 1 |
| `RagasMetric` | `(threshold=.3, model="gpt-3.5-turbo", embeddings=None)` | `input, actual_output, expected_output, retrieval_context`；返回五个分项的算术平均值 |

这些适配类没有共同 J 配置中的 `strict_mode`、`flaky`、`include_reason` 与 `verbose_mode`。
`a_measure()` 调用同步实现。`_track` 是下划线参数，不应成为稳定作者契约。
它们没有调用 DeepEval 的缺字段检查函数；不能假设 `skip_on_missing_params` 会识别这些空值。
研究判断：它们属于依赖外部包的兼容边缘，不宜与根导出 metric 当成同等级稳定面。

#### Community metric

[`CitationFaithfulnessMetric`](https://deepeval.com/docs/metrics-citation-faithfulness)
从 `deepeval.metrics.community` 导入。它使用 J 配置，但 `threshold=1.0`，
并要求 `input, actual_output, retrieval_context`；返回 0 到 1，方向为越高越好。
固定[实现文件](https://github.com/confident-ai/deepeval/blob/0abedb84c7db59873125e3c8e66199fa874c4878/deepeval/metrics/community/citation_faithfulness/citation_faithfulness.py)
是签名一手材料。

`ToolPermissionMetric` 与 `AgentLoopDetectionMetric` 也有 Community 页面，但已列入根导出表，
不在此重复成第二套 API。

### 5.7 `Scorer`：传统函数面

官方[metric 介绍](https://deepeval.com/docs/metrics-introduction#what-about-non-llm-as-a-judge-metrics)
明确说 `deepeval.scorer` 可用，但没有逐函数文档。以下清单来自固定
[`scorer.py`](https://github.com/confident-ai/deepeval/blob/0abedb84c7db59873125e3c8e66199fa874c4878/deepeval/scorer/scorer.py)，
因此稳定性低于有 API 页的 metric。

| API | 签名与返回 | 依赖或特殊语义 |
| --- | --- | --- |
| `Scorer.rouge_score` | `(target, prediction, score_type) -> float` | `score_type` 为 `rouge1`、`rouge2`、`rougeL`；需 `rouge-score` |
| `Scorer.sentence_bleu_score` | `(references, prediction, bleu_type="bleu1") -> float` | `bleu1`、`bleu2`、`bleu3`、`bleu4`；需 NLTK |
| `Scorer.exact_match_score` | `(target, prediction) -> int` | 去除两端空白后相等，返回 1 或 0 |
| `Scorer.quasi_exact_match_score` | `(target, prediction) -> int` | 规范化大小写、标点、冠词与空白后比较 |
| `Scorer.quasi_contains_score` | `(targets, prediction) -> int` | 规范化后的 prediction 是规范化 targets 的成员时返回 1；没有做子串包含 |
| `Scorer.bert_score` | `(references, predictions, model="microsoft/deberta-large-mnli", lang="en") -> float` 是源码标注 | 运行时返回 precision、recall、F1 列表组成的字典；需 `bert-score` |
| `Scorer.faithfulness_score` | `(target, prediction, model=None, granularity=None, device=None) -> float` | 神经模型 scorer；额外依赖按实现导入 |
| `Scorer.hallucination_score` | `(source, prediction, model=None) -> float` | 神经模型 scorer |
| `Scorer.PII_score` | `(target, prediction, model=None)` | 固定实现直接抛 `NotImplementedError`，不可用 |
| `Scorer.neural_toxic_score` | `(prediction, model=None) -> Union[float, dict]` | Detoxify 包装，实际模型可返回分类字典 |
| `Scorer.answer_relevancy_score` | `(predictions, target, model_type=None, model_name=None) -> float` | 神经相关性模型 |
| `Scorer.neural_bias_score` | `(text, model=None) -> float` | 神经偏见模型 |
| `Scorer.truth_identification_score` | `(target, prediction) -> int` | 返回四舍五入的 0 到 100 百分值；任意异常折为 0，不是 0 到 1 |
| `Scorer().pass_at_k` | `(n, c, k) -> float` | 按总样本数、正确数和抽样数计算 pass@k；需 NumPy |
| `Scorer().squad_score` | `(input, prediction, expected_output, evaluation_model, using_native_evaluation_model) -> float` | 内部 Judge 形状；需要模型对象及 native 标志 |

这些函数没有统一 threshold、reason、flaky、错误配置或 runner 结果行。
它们都是同步方法，没有 `a_*` 版本。
要让它们参与 `assert_test()` 与 `evaluate()`，作者必须用 `BaseMetric` 包装，并自行定义方向与阈值。

### 5.8 `measure()`、`assert_test()` 与 `evaluate()` 的选择

| 需求 | 入口 | 返回或失败 |
| --- | --- | --- |
| 调试一个 metric | `metric.measure(case)` | 返回分数并改写 metric 状态；异常直接抛出 |
| 异步应用调试一个 metric | `await metric.a_measure(case)` | 可等待；返回分数并改写 metric 状态 |
| Pytest 中作为准入条件 | `assert_test(case, metrics)` | 成功返回 `None`；失败抛 `AssertionError` |
| 脚本批量运行 | `evaluate(cases, metrics, ...)` | 返回 `EvaluationResult`；可写 JSON artifact |
| trace 数据集 | `dataset.evals_iterator(metrics=[...])` | 每个 `Golden` 包住一次观测；metric 在 trace 上运行 |
| 两两或多方回答比较 | `compare(arena_cases, arena_metric)` | 返回参赛者到胜场的字典 |

直接 `measure()` 不采用 `ErrorConfig`，也不会建立 Run。它适合局部查看 `reason` 与 `verbose_logs`。
CI 应使用 `assert_test()` 或 runner，让失败具备进程退出语义。

## 6. 可复制完整场景

以下示例均使用 4.1.5 的公开导入路径。确定性示例不需密钥；其余示例先设置：

```bash
export OPENAI_API_KEY="your-key"
```

也可把每个 `model="gpt-5.4"` 换成官方支持的模型名或 `DeepEvalBaseLLM` 实例。

### 6.1 场景一：两个确定性条件共同决定 Pytest 结果

保存为 `test_contract.py`：

```python
from deepeval import assert_test
from deepeval.metrics import ExactMatchMetric, PatternMatchMetric
from deepeval.test_case import LLMTestCase


def test_city_answer() -> None:
    case = LLMTestCase(
        input="Return only the capital of France.",
        actual_output="Paris",
        expected_output="Paris",
    )
    metrics = [
        ExactMatchMetric(),
        PatternMatchMetric(pattern=r"[A-Z][a-z]+"),
    ]
    assert_test(case, metrics)
```

```bash
deepeval test run test_contract.py
```

两个 metric 都有阈值，所以 test case 只有在两者都成功时通过。
这不是算术聚合；它是非 flaky 条件的逻辑与。

### 6.2 场景二：开放式 GEval Judge，带 rubric 与完整理由

保存为 `test_quality.py`：

```python
from deepeval import assert_test
from deepeval.metrics import GEval
from deepeval.metrics.g_eval import Rubric
from deepeval.test_case import LLMTestCase, SingleTurnParams


def test_explanation_quality() -> None:
    case = LLMTestCase(
        input="Why does ice float on liquid water?",
        actual_output=(
            "Water expands when it freezes, so ice is less dense than "
            "liquid water and buoyancy keeps it afloat."
        ),
        expected_output=(
            "The crystal structure of ice lowers its density below that "
            "of liquid water, so it floats."
        ),
    )
    correctness = GEval(
        name="Scientific correctness",
        criteria=(
            "Judge whether the actual output correctly answers the input "
            "and agrees with the expected output."
        ),
        evaluation_params=[
            SingleTurnParams.INPUT,
            SingleTurnParams.ACTUAL_OUTPUT,
            SingleTurnParams.EXPECTED_OUTPUT,
        ],
        rubric=[
            Rubric(
                score_range=(0, 4),
                expected_outcome="Incorrect or contradicts the reference.",
            ),
            Rubric(
                score_range=(5, 7),
                expected_outcome="Mostly correct but materially incomplete.",
            ),
            Rubric(
                score_range=(8, 10),
                expected_outcome="Correct, direct, and sufficiently explained.",
            ),
        ],
        threshold=0.8,
        model="gpt-5.4",
        verbose_mode=True,
    )
    assert_test(case, [correctness])
```

```bash
deepeval test run test_quality.py -v
```

这个示例显式列出 Judge 可见字段。`criteria` 说明判什么，rubric 说明各分段的可观察含义，
`threshold=.8` 决定 CI。因为 GEval 非确定，边界样本仍应多次核查，而不是把小数当作概率。

### 6.3 场景三：DAG 先判结构，再委托 GEval 判断内容

保存为 `test_dag.py`：

```python
from deepeval import assert_test
from deepeval.metrics import DAGMetric, GEval
from deepeval.metrics.dag import BinaryJudgementNode, DeepAcyclicGraph
from deepeval.test_case import LLMTestCase, SingleTurnParams


def test_structured_answer() -> None:
    case = LLMTestCase(
        input="Return a JSON object with the capital of France.",
        actual_output='{"capital": "Paris"}',
        expected_output='{"capital": "Paris"}',
    )

    valid_json = BinaryJudgementNode(
        criteria="Is the actual output a syntactically valid JSON object?",
        evaluation_params=[SingleTurnParams.ACTUAL_OUTPUT],
    )
    valid_json.add_verdict(False, score=0)
    valid_json.add_verdict(
        True,
        then=GEval(
            name="Answer correctness",
            criteria=(
                "Judge whether the actual output contains the same factual "
                "answer as the expected output."
            ),
            evaluation_params=[
                SingleTurnParams.ACTUAL_OUTPUT,
                SingleTurnParams.EXPECTED_OUTPUT,
            ],
        ),
    )

    metric = DAGMetric(
        name="Structured capital answer",
        dag=DeepAcyclicGraph(root_nodes=[valid_json]),
        model="gpt-5.4",
        threshold=0.8,
        include_reason=True,
        verbose_mode=True,
    )
    assert_test(case, [metric])
```

```bash
deepeval test run test_dag.py -v
```

`False` 路径固定为 0。`True` 路径采用子 GEval 的 0 到 1 分数。
这展示的是分支组合，不是 runner 对多个 metric 做加权。

### 6.4 场景四：多轮 Judge 与会话 metric 一起运行

保存为 `test_conversation.py`：

```python
from deepeval import assert_test
from deepeval.metrics import ConversationCompletenessMetric
from deepeval.metrics import ConversationalGEval
from deepeval.test_case import (
    ConversationalTestCase,
    MultiTurnParams,
    Turn,
)


def test_support_conversation() -> None:
    conversation = ConversationalTestCase(
        scenario="A customer asks to reset a forgotten password.",
        expected_outcome="The customer receives safe, actionable reset steps.",
        chatbot_role="Customer support agent",
        turns=[
            Turn(role="user", content="I forgot my password."),
            Turn(
                role="assistant",
                content=(
                    "Use the Forgot password link, then follow the email "
                    "verification steps. I will not ask for your password."
                ),
            ),
            Turn(role="user", content="What if the email does not arrive?"),
            Turn(
                role="assistant",
                content=(
                    "Check spam, verify the account email, wait a few minutes, "
                    "then contact support if it is still missing."
                ),
            ),
        ],
    )
    professionalism = ConversationalGEval(
        name="Professional support",
        criteria=(
            "Judge whether assistant turns are professional, safe, and "
            "actionable across the conversation."
        ),
        evaluation_params=[
            MultiTurnParams.ROLE,
            MultiTurnParams.CONTENT,
        ],
        threshold=0.7,
        model="gpt-5.4",
    )
    completeness = ConversationCompletenessMetric(
        threshold=0.7,
        model="gpt-5.4",
    )
    assert_test(conversation, [professionalism, completeness])
```

```bash
deepeval test run test_conversation.py
```

这里显式传 `ConversationalGEval.evaluation_params`，以符合 4.1.5 固定源码。
两个 metric 都成功时，整段会话才通过。

### 6.5 场景五：Arena Judge 聚合多题胜场

保存为 `compare_answers.py`：

```python
from deepeval import compare
from deepeval.metrics import ArenaGEval
from deepeval.test_case import (
    ArenaTestCase,
    Contestant,
    LLMTestCase,
    SingleTurnParams,
)


def arena_case(
    question: str,
    expected: str,
    answer_a: str,
    answer_b: str,
) -> ArenaTestCase:
    return ArenaTestCase(
        contestants=[
            Contestant(
                name="prompt-a",
                test_case=LLMTestCase(
                    input=question,
                    actual_output=answer_a,
                    expected_output=expected,
                ),
                hyperparameters={"prompt": "A"},
            ),
            Contestant(
                name="prompt-b",
                test_case=LLMTestCase(
                    input=question,
                    actual_output=answer_b,
                    expected_output=expected,
                ),
                hyperparameters={"prompt": "B"},
            ),
        ]
    )


cases = [
    arena_case("Capital of France?", "Paris", "Paris", "The capital is Paris."),
    arena_case("2 + 2?", "4", "Four.", "4"),
]
judge = ArenaGEval(
    name="Correct and concise",
    criteria=(
        "Choose the contestant whose actual output is more correct and "
        "concise relative to the expected output."
    ),
    evaluation_params=[
        SingleTurnParams.ACTUAL_OUTPUT,
        SingleTurnParams.EXPECTED_OUTPUT,
    ],
    model="gpt-5.4",
)

wins = compare(cases, judge, name="Prompt A versus Prompt B")
print(wins)
```

```bash
python compare_answers.py
```

输出形如 `{"prompt-a": 1, "prompt-b": 1}`，实际胜者由 Judge 决定。
Arena 没有平局协议；若应用需要平局、置信区间或成对随机化，需在 DeepEval 外另行定义。

## 7. 结果、诊断、artifact、CI 与重新判分

### 7.1 Python 返回对象

`evaluate()` 返回 `EvaluationResult`。每个 `TestResult` 具有 `name`、`success`、`metrics_data`、
`conversational`、`index`、`multimodal`、输入输出字段、上下文字段、`turns` 与 `metadata`。
[固定返回类型](https://github.com/confident-ai/deepeval/blob/0abedb84c7db59873125e3c8e66199fa874c4878/deepeval/evaluate/types.py)
是字段真源。

每个 `MetricData` 具有 `name`、`threshold`、`success`、`score`、`reason`、`strict_mode`、
`flaky`、`evaluation_model`、`error`、`evaluation_cost`、输入输出 token 和 `verbose_logs`。
`score` 与 `success` 都可能为 `None`。[固定模型](https://github.com/confident-ai/deepeval/blob/0abedb84c7db59873125e3c8e66199fa874c4878/deepeval/tracing/api.py)
说明这一可空性。

```python
from deepeval import evaluate
from deepeval.evaluate import AsyncConfig, CacheConfig, DisplayConfig, ErrorConfig
from deepeval.metrics import AnswerRelevancyMetric
from deepeval.test_case import LLMTestCase

result = evaluate(
    test_cases=[
        LLMTestCase(
            input="What is the capital of France?",
            actual_output="Paris",
        )
    ],
    metrics=[AnswerRelevancyMetric(threshold=0.7, model="gpt-5.4")],
    identifier="capital-smoke",
    async_config=AsyncConfig(
        run_async=True,
        throttle_value=0,
        max_concurrent=10,
    ),
    display_config=DisplayConfig(
        show_indicator=True,
        print_results=True,
        results_folder="./eval-results",
        results_subfolder="runs",
        inspect_after_run=False,
    ),
    cache_config=CacheConfig(write_cache=True, use_cache=False),
    error_config=ErrorConfig(
        ignore_errors=False,
        skip_on_missing_params=False,
    ),
)

for test_result in result.test_results:
    for metric_data in test_result.metrics_data or []:
        print(metric_data.name, metric_data.score, metric_data.reason)
```

`AsyncConfig` 默认 `run_async=True, throttle_value=0, max_concurrent=20`。
`CacheConfig` 默认 `write_cache=True, use_cache=False`。
`ErrorConfig` 两项默认 `False`。[官方配置页](https://deepeval.com/docs/evaluation-flags-and-configs)
提供对应作者说明。

### 7.2 诊断与详细日志

`reason` 是面向 metric 最终分数的解释。`verbose_logs` 是中间步骤文本。
metric 的 `verbose_mode=True` 或 `DisplayConfig(verbose_mode=True)` 会启用详细模式；
CLI 使用 `-v`。关闭 `include_reason` 可省去 Judge 理由调用，但并非每个 metric 暴露此选项。

`DisplayConfig` 的 4.1.5 默认值是：

```python
DisplayConfig(
    show_indicator=True,
    print_results=True,
    verbose_mode=None,
    display_option=TestRunResultDisplay.ALL,
    results_folder=None,
    results_subfolder=None,
    truncate_passing_cases=True,
    inspect_after_run=True,
    file_type=None,
    file_output_dir=None,
)
```

`file_type` 与 `file_output_dir` 在固定源码注释中标为过时。
新代码使用 `results_folder`，每次 `evaluate()` 写入 `test_run_<timestamp>.json`。
`results_subfolder` 在父目录下增加一级目录。
`display_option` 可取 `ALL`、`FAILING` 或 `PASSING`。

安装 `deepeval[inspect]` 后，`deepeval inspect <file-or-folder>` 打开本地 TUI。
它最有价值的输入是含 trace 的 Run，可逐 span 查看分数和理由。
[官方 CLI 页](https://deepeval.com/docs/command-line-interface)给出路径优先级和安装方式。

### 7.3 CLI 与 CI

4.1.5 的完整 `deepeval test run` 作者选项如下，另可在末尾传 Pytest 参数：

| 选项 | 作用 |
| --- | --- |
| `test_file_or_directory` | 必填路径，也接受 Pytest node id |
| `--color` | Pytest 颜色；默认 `yes` |
| `--durations` | 显示最慢用例数；默认 10 |
| `--pdb` | 失败时进入 PDB；默认关闭 |
| `-x/-X`, `--exit-on-first-failure` | 首个 Pytest 失败后停止 |
| `-w/-W`, `--show-warnings` | 显示 warning；默认隐藏 |
| `-id`, `--identifier` | 标识 Run |
| `-n`, `--num-processes` | 交给 pytest-xdist 的进程数 |
| `-r`, `--repeat` | 重复每个 test case；至少 1 |
| `-c`, `--use-cache` | 未使用 `--repeat` 时复用相同输入和 metric 的缓存结果 |
| `-i`, `--ignore-errors` | 把 metric 异常写成错误结果并继续 |
| `-s`, `--skip-on-missing-params` | 缺少 metric 必需字段时移除该次 metric 结果 |
| `-v`, `--verbose` | 开启 metric 详细模式 |
| `-d`, `--display` | 选择最终显示的 test case 集合 |
| `-m`, `--mark` | 传入 Pytest mark 表达式 |
| `-o`, `--official` | 在 Confident AI 标记官方对照 Run；需要 `CONFIDENT_API_KEY` |

CI 最小命令是：

```bash
deepeval test run tests/test_eval.py
```

DeepEval 把 Pytest 非零退出码原样传给进程。官方[CI 文档](https://deepeval.com/docs/evaluation-unit-testing-in-ci-cd)
建议使用该命令；直接 `pytest` 不会获得完整 DeepEval runner 行为。
`@deepeval.on_test_run_end` 可在 CLI Run 结束后执行通知、导出或资源终结逻辑。

### 7.4 Trace 与 Agent 运行集成

固定的 iterator 签名是：

```text
EvaluationDataset.evals_iterator(
    metrics: list[BaseMetric] | None = None,
    hyperparameters: dict | None = None,
    identifier: str | None = None,
    display_config: DisplayConfig | None = None,
    cache_config: CacheConfig | None = None,
    error_config: ErrorConfig | None = None,
    async_config: AsyncConfig | None = None,
    run_otel: bool = False,
) -> Iterator[Golden]
```

传给 iterator 的 metric 在整个 trace 上求值。传给 `@observe(metrics=[...])` 的 metric
在该 span 上求值；两类分数可进入同一个 Run。`@observe` 还接受 `metric_collection` 与 span `type`。

Trace-only metric 的最短官方形状是 dataset iterator 加 `@observe`：

```python
from deepeval.dataset import EvaluationDataset, Golden
from deepeval.metrics import TaskCompletionMetric
from deepeval.tracing import observe, update_current_trace


@observe
def agent(user_input: str) -> str:
    output = "The reset link is in the account settings page."
    update_current_trace(input=user_input, output=output)
    return output


dataset = EvaluationDataset(
    goldens=[Golden(input="Help me reset my password.")]
)
metric = TaskCompletionMetric(threshold=0.7, model="gpt-5.4")

for golden in dataset.evals_iterator(metrics=[metric]):
    agent(golden.input)
```

真实 Agent 应在子函数、工具与模型调用上继续使用 `@observe`，并通过
`update_current_trace()` 写入 trace 级输入输出。
[官方 trace 评估](https://deepeval.com/docs/evaluation-end-to-end-single-turn)与
[计划质量示例](https://deepeval.com/docs/metrics-plan-quality)展示这一组合。

`assert_test(golden=golden)` 是另一条 trace 作用域入口。
`EvaluationDataset` 还可保存 `goldens` 与加入 test case。
异步 iterator 用 `dataset.evaluate(task)` 登记已调度的 awaitable；该方法不返回 `EvaluationResult`。
`Golden` 是执行前样本，不等于已有 `actual_output` 的 `LLMTestCase`。

### 7.5 本地 artifact、云端 Run 与重新判分

本地 JSON 保存输入、输出、超参数、metric 分数、理由和 trace 数据。
Confident AI 登录后，Run 还可上传并得到 `confident_link` 与 `test_run_id`。
`metric_collection`、`GEval.upload()`、`DAGMetric.upload()` 都属于平台依赖面。

`CacheConfig(use_cache=True)` 与 CLI `-c` 只复用“相同 test case 与相同 metric 配置”的旧结果。
它不是把一个 JSON Run 交给新 metric 的重新判分接口。

要以新阈值、rubric、Judge 或 metric 重新判分，4.1.5 的公开路径是保留原始 test case 数据，
再调用 `evaluate()` 或 CLI。本文没有在官方 API 中找到“读取已保存 Run JSON 并换 metric”入口。
因此 JSON 可审阅、可比较，但不能假设它是稳定的可重新判分输入格式。

## 8. 自定义扩展

### 8.1 自定义确定性 metric

官方[自定义 metric 指南](https://deepeval.com/docs/metrics-custom)要求继承 `BaseMetric`，
实现 `measure()` 与 `a_measure()`，并写入 `score` 和 `success`。下面的完整实现也处理 score-only、
严格模式、flaky、理由与详细日志：

```python
from deepeval.metrics import BaseMetric
from deepeval.test_case import LLMTestCase


class ConcisionMetric(BaseMetric):
    def __init__(
        self,
        max_words: int = 30,
        threshold: float | None = 1.0,
        include_reason: bool = True,
        strict_mode: bool = False,
        verbose_mode: bool = False,
        flaky: bool = False,
    ) -> None:
        if max_words < 1:
            raise ValueError("max_words must be positive")
        self.max_words = max_words
        self.threshold = 1.0 if strict_mode else threshold
        self.include_reason = include_reason
        self.strict_mode = strict_mode
        self.verbose_mode = verbose_mode
        self.flaky = flaky
        self.async_mode = False
        self.evaluation_model = None

    def measure(self, test_case: LLMTestCase) -> float:
        if test_case.actual_output is None:
            raise ValueError("actual_output is required")
        word_count = len(test_case.actual_output.split())
        raw_score = min(self.max_words / max(word_count, 1), 1.0)
        self.score = (
            0.0
            if self.strict_mode and raw_score < 1.0
            else raw_score
        )
        self.reason = (
            f"Output has {word_count} words; limit is {self.max_words}."
            if self.include_reason
            else None
        )
        self.success = self.is_successful()
        self.verbose_logs = (
            f"word_count={word_count}; raw_score={raw_score}"
            if self.verbose_mode
            else None
        )
        return self.score

    async def a_measure(self, test_case: LLMTestCase) -> float:
        return self.measure(test_case)

    @property
    def __name__(self) -> str:
        return "Concision"
```

它可直接传给 `assert_test()` 与 `evaluate()`。如果真实计算需要网络 I/O，
`a_measure()` 应使用异步客户端；不要在其中调用会阻塞事件循环的同步 SDK。

### 8.2 自定义多轮与 Arena metric

多轮扩展继承 `BaseConversationalMetric`，两个测量方法接收 `ConversationalTestCase`。
它必须自行声明和检查所需 turn 字段，并采用共同状态字段。
官方自定义指南提供单轮与多轮切换示例。

`BaseArenaMetric` 也从根模块导出。子类要实现返回胜者名的 `measure()` 与 `a_measure()`，
还要实现抽象 `is_successful()`。
但是 4.1.5 的 `compare()` 类型签名与复制逻辑固定到 `ArenaGEval`。
研究判断：自定义 Arena metric 不能视为受保证的 `compare()` 扩展点，除非先在目标 tag 做真实执行核查。

### 8.3 自定义 Judge 模型

模型扩展继承 `DeepEvalBaseLLM`，实现模型加载、同步生成、异步生成与模型名方法，
再把实例传给支持 `model` 的 metric。[官方自定义模型指南](https://deepeval.com/guides/guides-using-custom-llms)
是该协议的一手材料。

GEval、DAG、内置 Judge metric 都可采用这个对象，但概率加权能力取决于具体模型适配。
自定义模型返回格式不符合 metric 所需 schema 时，默认会抛错；可用 `ErrorConfig` 改变 Run 行为，
不应把格式错误解释为低分。

### 8.4 自定义组合策略

需要“格式失败即 0，否则 Judge”的规则时用 DAG。需要加权总分时写一个 `BaseMetric`，
在内部调用子 metric，并把公式、方向、失败处理和理由固定下来。
只把多个 metric 放进 `assert_test()` 表示逻辑与，不表示平均值。

子 metric 若有网络调用，组合类必须同时实现正确的异步路径。
还应把子 metric 的错误、费用、token 与理由并入自己的诊断，避免只留下一个无法追溯的总分。

## 9. 好在哪里

本节是研究判断，不是官方自述。

### 9.1 `measure()` 之后就能检查完整状态

作者可先单独运行一个 metric，再直接看 `score`、`reason`、`success` 与 `verbose_logs`。
同一对象随后可放进 `assert_test()` 或 `evaluate()`，局部调试与 CI 不需要两套判分实现。

### 9.2 阈值、score-only 与 flaky 位于 metric 调用点

`threshold=.7`、`threshold=None` 和 `flaky=True` 都紧邻 metric 构造。
读者不用去 Run 末尾寻找门槛，也能把“观察但不阻止 CI”与“正式条件”区分开。
test case 级 flaky 还提供另一层退出语义。

### 9.3 GEval 把可见字段写成枚举

`evaluation_params=[SingleTurnParams.INPUT, ...]` 明确限定 Judge 看到什么。
这比在长模板中隐式引用任意键更容易审阅。`criteria`、`evaluation_steps` 与 `Rubric`
又把目标、步骤和分段含义拆开，作者可以逐层收紧开放 Judge。

### 9.4 DAG 让分支规则可检查、可序列化

`add_verdict(False, score=0)` 比把条件藏在一个总提示中更具体。
图会拒绝环、重复 verdict 与非法二元分支，还能转成 JSON。
自顶向下 API 让阅读顺序和执行顺序一致。

### 9.5 普通、对话、Arena 与 trace metric 使用相近词汇

四种形状都围绕 test case、metric、reason、详细日志与 runner。
作者学习一个内置 RAG metric 后，迁移到对话或 Agent metric 时仍能识别阈值与异步参数。
Arena 的胜者返回也没有强行并入普通 `float` 协议。

### 9.6 CI、JSON artifact 与 trace 诊断在同一工具链

`deepeval test run` 复用 Pytest 的选择、mark、xdist 与退出码。
`evaluate()` 可写结构化 JSON，`inspect` 可看 trace，平台上传是可选路径。
从单个 metric 调试到批量 Run，不必更换 test case 模型。

## 10. 不好的地方与不应类比 NiceEval 的边界

本节同样是研究判断；其中的 API 事实均可回到第 2 节固定源码定位。

### 10.1 DeepEval 主要是 Sample Scorer，不是 Run Assertion

`LLMTestCase` 表达模型输入输出、参照文本、工具摘要与上下文。
它不拥有命令执行、Sandbox 文件、进程退出、资源释放或任意运行事件。
NiceEval 不能把“把输出塞入 test case 再打分”类比成完整的运行断言面。

### 10.2 Runner 只有逻辑与，没有数据集级门槛公式

多个 metric 的默认规则是全部成功。它没有公开权重、points、平均分、分位数、显著性或公式 API。
Arena 只数胜场。需要 Aggregate Gate 的产品不能从 `assert_test()` 推导出相应能力。

### 10.3 跳过、score-only 与错误不是显式结果联合类型

score-only 用 `success=None`，ignored error 用 `score=None, success=False`，缺字段跳过则移除结果行。
全被移除的 test case 还可能保持成功。调用方必须从空列表反推“没有证据”，容易误放行。
NiceEval 不应复制这种省略式跳过语义。

### 10.4 Metric 是可变执行器，也是结果容器

`measure()` 改写同一实例，使快速调试很顺手，却让手工并发、重入与结果保留更难推理。
不可变 `Score` 或每次调用返回独立结果，会更适合长期保存和跨线程组合。

### 10.5 严格模式并非完全一致

4.1.5 的 `RoleViolationMetric` 以 1 表示无违规，却在 `strict_mode=True` 时把阈值设为 0。
它又继承 `score >= threshold`，因此违规分 0 也能达到阈值。
这是固定源码可复查的不一致；安全条件不应在该版本依赖此 strict 选项。

### 10.6 Judge 分数不是客观概率

GEval、DAG 分支、Arena 与多数 built-in metric 都依赖 Judge 提示、模型版本和抽样行为。
`threshold=.8` 只是作者门槛，不表示 80% 正确概率。
默认 Judge 还会随 DeepEval 版本变化；关键 CI 应显式指定模型并保存 rubric 与理由。

### 10.7 Test case 是宽而稀疏的可选字段集合

单轮对象同时包含 RAG、工具、MCP、图像、成本和标签字段。
Pydantic 能检查字段类型，却不能在构造时知道后续 metric 需要哪组字段；错误延迟到运行阶段。
`skip_on_missing_params` 进一步把 schema 不匹配变成隐式空结果。

### 10.8 文档与固定 tag 会漂移

官网是滚动文档，没有版本选择器。4.1.5 的 `ConversationalGEval`、`compare()` 与
`DisplayConfig` 已能观察到文档示例和固定签名不同。
没有固定 commit 的读者可能复制到尚未安装版本的形状。

### 10.9 边缘 API 的稳定度差异很大

根 metric 有完整页面，`Scorer` 只有一句入口说明，`PII_score` 直接抛 `NotImplementedError`。
RAGAS 类不在根导出，还暴露 `_track`。Community 分类与根导出也有交叉。
“官方仓库里存在”不能等同于“稳定公开契约”。

### 10.10 JSON artifact 不是经声明的重新判分协议

本地 JSON 适合诊断与比较，但官方没有承诺从该文件构造 test case 并应用新 metric。
NiceEval 若要支持 regrade，应把原始事实、grader 版本和判分结果分层，不能只依赖报告快照。

## 11. 对 NiceEval 可吸收与不应复制

本节只给研究输入，不构成 NiceEval 产品契约。

### 11.1 可吸收

- 让 Judge 的 `reason`、模型身份、费用、token 与详细日志和分数一起返回。
- 在调用点明确区分正式条件、score-only 与 flaky，并让报告仍显示非阻断失败。
- 用枚举或类型化 selector 声明 Judge 可见事实，避免 rubric 隐式读取整个运行状态。
- 为开放 Judge 提供 criteria、步骤与 rubric 三层作者面，并保留固定后的完整定义。
- 为分支型判分提供可检查的组合结构；每个末端必须明确分数或下一条规则。
- 让单 metric 可独立调试，又能无额外包装进入批量 runner 与 CI。
- 把同步入口和真正可等待入口分开说明，并在批量执行配置中公开并发上限与节流秒数。
- 让本地 artifact 含每项失败理由与完整超参数，便于 coding agent 直接检查。

### 11.2 不应复制

- 不复制“缺字段就删除结果行、全空仍可能成功”的语义。NiceEval 应保留显式 `unavailable` 或错误事实。
- 不把可变 evaluator 实例同时当作长期结果对象。每次求值应产生独立、可保存的判分结果。
- 不把很多领域的可选字段堆进一个 Sample。运行 scope、输出、工具事件、文件事实与 Judge 输入应保留所有权。
- 不把多个断言的逻辑与冒充总分策略。题内 points、Verdict 折叠与数据集统计应分别建模。
- 不让 `strict_mode` 暗中改阈值方向。方向、比较符和满分要求应能从配置直接读出。
- 不让默认云端 Judge 成为不可见依赖。模型、提示版本与调用失败必须进入结果 provenance。
- 不把平台上传、官方对照 Run 与本地判分绑成一个成功条件。离线作者面应保持完整。
- 不把报告 JSON 当作 regrade 真源。应保存足以重新求值的不可变运行事实与 grader 身份。

## 12. 无法核实项

以下各项在观察日无法由同一版本的一手材料闭合。它们不是 API 承诺。

1. 官网滚动页的 `ConversationalGEval` 示例省略 `evaluation_params`，并列出固定构造函数没有的
   `evaluation_template`。4.1.5 在测量时会要求非空参数；本文采用固定源码形状。

2. 官网 Arena 示例曾把 `hyperparameters` 传给 `compare()`，而 4.1.5 的函数没有该参数。
   固定 API 把超参数放在每个 `Contestant.hyperparameters`。

3. 官网展示配置时使用过 `DisplayConfig(display=...)`，固定 dataclass 字段是
   `display_option`。本文不声称滚动文档示例可在 4.1.5 直接运行。

4. 没有找到公开函数可读取 `test_run_*.json`，再用新 metric、rubric 或 Judge 重新判分。
   `deepeval inspect` 是检查入口，缓存只复用相同输入与 metric 配置。

5. `BaseArenaMetric` 是根导出的抽象类，但 `compare()` 接受并复制 `ArenaGEval`。
   官方资料没有闭合自定义 Arena metric 的 runner 兼容承诺。

6. `Scorer` 的模型下载、设备选择和可选依赖没有逐函数官方参考页。
   本文能固定签名与代码路径，不能保证每个模型依赖在 Python 3.9 至 3.13 都可安装。

7. `Scorer.PII_score()` 的形状存在，但固定代码只有 `NotImplementedError`。
   无法核实任何可用返回范围、失败理由或替代 scorer。

8. Community 分类没有单独的稳定性政策。`ToolPermissionMetric` 与
   `AgentLoopDetectionMetric` 已从根导出，`CitationFaithfulnessMetric` 尚未从根导出；
   本文只陈述 4.1.5 的事实，不推断后续兼容承诺。

9. 官网没有把每个滚动页面固定到 `v4.1.5`。页面中默认 Judge、重试策略、CLI artifact 路径
   与固定 tag 不同时，只能分别陈述，不能合成一个版本保证。

10. `RoleViolationMetric(strict_mode=True)` 的阈值方向与分数方向不一致。
    固定源码能证明行为，但官方页面没有解释它是预期设计还是缺陷。

11. 官网说根 `evaluate(test_cases=...)` 可接 `EvaluationDataset`，而固定签名只接两类 test case 列表，
    函数体也没有把 dataset 转为列表。本文只教固定源码可以证明的列表形状。

12. 滚动 metric 介绍页展示过 `evaluate(observed_callback=..., goldens=...)`。
    4.1.5 的根 `evaluate()` 没有这两个参数；trace 示例因此采用 `evals_iterator()`。

13. `TaskCompletionMetric` 固定源码保留无 trace 的兼容路径，并注释准备弃用。
    官方资料没有给出移除版本，不能把该路径当作后续兼容承诺。
