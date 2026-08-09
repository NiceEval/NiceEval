# LangSmith Evaluation：断言、评估器与反馈作者面

> 观察日：2026-08-09。本文是竞品研究，不是 NiceEval 契约。
>
> “官方事实”来自本文列出的一手材料。“研究判断”是对作者体验与产品边界的分析。

## 1. 定位与真实边界

LangSmith Evaluation 是围绕数据集、实验、生产 trace 与 feedback 构成的评估系统。
离线评估在数据集上执行应用，再让逐行评估器和汇总评估器写 feedback。
在线评估从生产 trace 或 thread 中取样，再由托管的 Judge、代码或组合评估器写 feedback。
[官方事实：评估类型](https://docs.langchain.com/langsmith/evaluation-types)

它不是一个单纯的断言库。SDK 的逐行评估器返回分数、值、评语或修正内容，本身不会把低分变成进程失败。
要在 CI 中失败，作者需使用 pytest、Vitest、Jest 的原生断言，或自行把 feedback 与阈值比较。

LangSmith 另有名为 Assertions 的 UI 能力。审阅者在单条 trace 的标注队列中写自然语言要求。
系统把这些要求保存到数据集样例的 `outputs.assertions`，后续仍要由离线评估器逐条检查。
它不适用于 thread 或成对标注队列；官方支持文档明确把创建面限定在 UI。
[官方事实：Assertions](https://docs.langchain.com/langsmith/assertions)

本文完整盘点以下公开作者面：

- Python 与 TypeScript 离线执行入口；
- 自定义逐行、汇总、比较评估器及其返回协议；
- OpenEvals 的确定性、Judge、轨迹、JSON 与代码评估器；
- 在线 Judge、代码、组合、thread 评估器及复用资源；
- feedback、feedback config、人工标注队列与 trace 标注；
- repetitions、既有实验再评分、pytest、Vitest 与 Jest 接入。

本文不盘点无关的模型 provider、部署产品、通用 tracing 装饰器、查询语言或观测 SDK。
只有在它们向评估器提供输入、写 feedback 或影响 trace 保留期时，才说明相关部分。

### 名词边界

| LangSmith 名词 | 本文中的准确含义 |
| --- | --- |
| Example | 数据集中的输入、可选参考输出、附件与元数据。 |
| Run | 一次目标调用或子调用；实验中的根 Run 与 Example 关联。 |
| Experiment | 同一目标在一个数据集上的一组 Run；API 也常称 project 或 session。 |
| Evaluator | 读取 Run、Example 或简化字段并返回评价结果的函数或托管资源。 |
| EvaluationResult | 评估器的临时返回对象；runner 随后把它写成 Feedback。 |
| Feedback | 绑定 Run、trace 或 Experiment 的持久评价数据。 |
| Assertion | UI 中保存到 `outputs.assertions` 的自然语言验收要求，不是执行器。 |
| Annotation queue | 把 Run 或 thread 分派给人工审阅者的队列。 |
| Comparative experiment | 将两个或更多既有实验按共同 Example 对齐后的比较任务。 |

## 2. 观察版本和一手链接

### 固定快照

| 包或仓库 | 观察版本 | 固定点 |
| --- | --- | --- |
| Python `langsmith` | `0.10.17` | [PyPI 发布页](https://pypi.org/project/langsmith/0.10.17/) |
| npm `langsmith` | `0.8.9` | [npm registry 元数据](https://registry.npmjs.org/langsmith/0.8.9) |
| Python 与 npm `openevals` | `0.2.0` | [PyPI](https://pypi.org/project/openevals/0.2.0/) · [npm registry 元数据](https://registry.npmjs.org/openevals/0.2.0) |
| `langsmith-sdk` Python | `ea8caba352b122b6f36fc5eaf45756ca00470e0a` | [官方仓库 commit](https://github.com/langchain-ai/langsmith-sdk/tree/ea8caba352b122b6f36fc5eaf45756ca00470e0a) |
| `langsmith-sdk` npm | `7ddda3c20b2338fdb0abc7ef49e9f445b8d07c79` | [npm `gitHead`](https://github.com/langchain-ai/langsmith-sdk/tree/7ddda3c20b2338fdb0abc7ef49e9f445b8d07c79) |
| `openevals` Python | `cf22d62f030cdf607f8c02bd604cb6374511642f` | [官方 `openevals==0.2.0` tag commit](https://github.com/langchain-ai/openevals/tree/cf22d62f030cdf607f8c02bd604cb6374511642f) |
| `openevals` npm | `a308f8afb8a7b0bae8052db00d9e8a8e4dc59b73` | [npm `gitHead`](https://github.com/langchain-ai/openevals/tree/a308f8afb8a7b0bae8052db00d9e8a8e4dc59b73) |

官方网页会滚动更新，不能固定到 commit。本文在观察日读取网页，并用上述 SDK commit 核对签名、默认值与弃用标记。
两个 OpenEvals commit 的 `js/src` 内容相同；TS catalog 以 npm `gitHead` 为发布对照点。

### 一手材料表

后文表格中的 `S1` 至 `S21` 均指向这里。

| 编号 | 官方材料 | 用途 |
| --- | --- | --- |
| S1 | [Evaluation quickstart](https://docs.langchain.com/langsmith/evaluation-quickstart) | 安装、数据集、首个实验与 OpenEvals 接法。 |
| S2 | [Evaluation types](https://docs.langchain.com/langsmith/evaluation-types) | 离线、在线、代码、组合、汇总与比较边界。 |
| S3 | [Custom evaluators](https://docs.langchain.com/langsmith/code-evaluator) | Python 与 TypeScript 自定义函数形状。 |
| S4 | [Python runner 固定源码](https://github.com/langchain-ai/langsmith-sdk/blob/ea8caba352b122b6f36fc5eaf45756ca00470e0a/python/langsmith/evaluation/_runner.py) | `evaluate`、结果对象、比较与错误处理。 |
| S5 | [Python evaluator 固定源码](https://github.com/langchain-ai/langsmith-sdk/blob/ea8caba352b122b6f36fc5eaf45756ca00470e0a/python/langsmith/evaluation/evaluator.py) | 回调参数、返回类型与装饰器。 |
| S6 | [TypeScript runner 固定源码](https://github.com/langchain-ai/langsmith-sdk/blob/7ddda3c20b2338fdb0abc7ef49e9f445b8d07c79/js/src/evaluation/_runner.ts) | TS 执行选项、回调类型与结果对象。 |
| S7 | [TypeScript evaluator 固定源码](https://github.com/langchain-ai/langsmith-sdk/blob/7ddda3c20b2338fdb0abc7ef49e9f445b8d07c79/js/src/evaluation/evaluator.ts) | TS `EvaluationResult` 与 `RunEvaluator`。 |
| S8 | [Pairwise evaluation](https://docs.langchain.com/langsmith/evaluate-pairwise) · [Repetitions](https://docs.langchain.com/langsmith/repetition) | 比较与重复执行。 |
| S9 | [Re-evaluate an experiment](https://docs.langchain.com/langsmith/evaluate-existing-experiment) | 读取既有 Run 后再评分。 |
| S10 | [OpenEvals Python 固定源码](https://github.com/langchain-ai/openevals/tree/cf22d62f030cdf607f8c02bd604cb6374511642f) · [OpenEvals npm 固定源码](https://github.com/langchain-ai/openevals/tree/a308f8afb8a7b0bae8052db00d9e8a8e4dc59b73) | 预制评估器、配置、返回协议与 prompt 常量。 |
| S11 | [Manage evaluators](https://docs.langchain.com/langsmith/evaluators) · [在线 Judge](https://docs.langchain.com/langsmith/online-evaluations-llm-as-judge) | 评估器资源与在线 Judge。 |
| S12 | [在线代码评估器](https://docs.langchain.com/langsmith/online-evaluations-code) · [在线组合评估器](https://docs.langchain.com/langsmith/online-evaluations-composite) | 托管代码、依赖限制与聚合。 |
| S13 | [多轮在线评估](https://docs.langchain.com/langsmith/online-evaluations-multi-turn) · [绑定数据集](https://docs.langchain.com/langsmith/bind-evaluator-to-dataset) | thread 输入与自动离线执行。 |
| S14 | [Feedback SDK](https://docs.langchain.com/langsmith/attach-user-feedback) · [Feedback 格式](https://docs.langchain.com/langsmith/feedback-data-format) | trace feedback 的写入与数据形状。 |
| S15 | [Assertions](https://docs.langchain.com/langsmith/assertions) · [标注队列](https://docs.langchain.com/langsmith/annotation-queues) · [队列 SDK](https://docs.langchain.com/langsmith/annotation-queues-sdk) | 自然语言要求、人工反馈与 rubric。 |
| S16 | [pytest](https://docs.langchain.com/langsmith/pytest) · [Vitest/Jest](https://docs.langchain.com/langsmith/vitest-jest) · [Python testing 固定源码](https://github.com/langchain-ai/langsmith-sdk/blob/ea8caba352b122b6f36fc5eaf45756ca00470e0a/python/langsmith/testing/_internal.py) · [TS jestlike 固定源码](https://github.com/langchain-ai/langsmith-sdk/tree/7ddda3c20b2338fdb0abc7ef49e9f445b8d07c79/js/src/utils/jestlike) | 测试框架接入、缓存、返回与反馈。 |
| S17 | [Python Client 固定源码](https://github.com/langchain-ai/langsmith-sdk/blob/ea8caba352b122b6f36fc5eaf45756ca00470e0a/python/langsmith/client.py) | Feedback、配置、标注队列与资源属性签名。 |
| S18 | [TypeScript Client 固定源码](https://github.com/langchain-ai/langsmith-sdk/blob/7ddda3c20b2338fdb0abc7ef49e9f445b8d07c79/js/src/client.ts) | TS Feedback、配置与标注队列签名。 |
| S19 | [Python 在线 evaluator 资源](https://github.com/langchain-ai/langsmith-sdk/blob/ea8caba352b122b6f36fc5eaf45756ca00470e0a/python/langsmith/_openapi_client/resources/online_evaluators.py) · [Python 标注队列资源](https://github.com/langchain-ai/langsmith-sdk/tree/ea8caba352b122b6f36fc5eaf45756ca00470e0a/python/langsmith/_openapi_client/resources/annotation_queues) · [TS 在线 evaluator 资源](https://github.com/langchain-ai/langsmith-sdk/blob/7ddda3c20b2338fdb0abc7ef49e9f445b8d07c79/js/src/_openapi_client/resources/online-evaluators.ts) · [TS 标注队列资源](https://github.com/langchain-ai/langsmith-sdk/tree/7ddda3c20b2338fdb0abc7ef49e9f445b8d07c79/js/src/_openapi_client/resources/annotation-queues) | 资源方法、分页返回、可省略参数与同步性。 |
| S20 | [Python `StringEvaluator`](https://github.com/langchain-ai/langsmith-sdk/blob/ea8caba352b122b6f36fc5eaf45756ca00470e0a/python/langsmith/evaluation/string_evaluator.py) · [Python `LLMEvaluator`](https://github.com/langchain-ai/langsmith-sdk/blob/ea8caba352b122b6f36fc5eaf45756ca00470e0a/python/langsmith/evaluation/llm_evaluator.py) · [TS `StringEvaluator`](https://github.com/langchain-ai/langsmith-sdk/blob/7ddda3c20b2338fdb0abc7ef49e9f445b8d07c79/js/src/evaluation/string_evaluator.ts) | legacy 类配置、返回与弃用状态。 |
| S21 | [行内标注 trace 与 Run](https://docs.langchain.com/langsmith/annotate-traces-inline) · [设置 feedback criteria](https://docs.langchain.com/langsmith/set-up-feedback-criteria) | 人工行内分数、评语、中间 Run 与分类值的保存方式。 |

## 3. 安装、最小项目与首个可运行 eval

### Python：零模型费用的首个实验

需要 LangSmith 账号和 API key。以下命令只安装固定版本，不会调用付费模型。

```bash
mkdir langsmith-eval-demo
cd langsmith-eval-demo
python -m venv .venv
source .venv/bin/activate
python -m pip install "langsmith==0.10.17"

export LANGSMITH_API_KEY="your-key"
export LANGSMITH_TRACING="true"
```

新建 `eval_demo.py`。脚本创建唯一数据集，写入两个 Example，执行目标函数，再写布尔 feedback。
数据集与实验会留在 LangSmith 账户中。

```python
from datetime import datetime, timezone

from langsmith import Client


client = Client()
suffix = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
dataset_name = f"arithmetic-demo-{suffix}"

dataset = client.create_dataset(
    dataset_name,
    description="Small deterministic evaluation demo",
)
client.create_examples(
    dataset_id=dataset.id,
    examples=[
        {
            "inputs": {"question": "What is 2 + 2?"},
            "outputs": {"answer": "4"},
        },
        {
            "inputs": {"question": "What is 7 - 3?"},
            "outputs": {"answer": "4"},
        },
    ],
)


def target(inputs: dict) -> dict:
    answers = {
        "What is 2 + 2?": "4",
        "What is 7 - 3?": "4",
    }
    return {"answer": answers[inputs["question"]]}


def exact_answer(outputs: dict, reference_outputs: dict) -> dict:
    passed = outputs["answer"] == reference_outputs["answer"]
    return {
        "key": "exact_answer",
        "score": passed,
        "comment": "Exact string equality",
    }


results = client.evaluate(
    target,
    data=dataset_name,
    evaluators=[exact_answer],
    experiment_prefix="arithmetic-demo",
    max_concurrency=0,
)

for row in results:
    print(row["run"].outputs, row["evaluation_results"])
print(results.url)
```

执行：

```bash
python eval_demo.py
```

`max_concurrency=0` 表示顺序执行。`client.evaluate` 返回可迭代的 `ExperimentResults`，并打印实验链接。
调用形状与官方 quickstart 一致；数据集写入采用 0.10.17 推荐的 `examples=[example_1, example_2]` 形状。见 S1、S4。

### TypeScript：最小自定义评估器

```bash
mkdir langsmith-eval-ts
cd langsmith-eval-ts
npm init -y
npm install langsmith@0.8.9
npm install --save-dev tsx typescript @types/node

export LANGSMITH_API_KEY="your-key"
export LANGSMITH_TRACING="true"
```

假设账户中已有名为 `Sample dataset` 的数据集，新建 `eval.ts`：

```ts
import { evaluate } from "langsmith/evaluation";

const target = async (inputs: { question: string }) => ({
  answer: inputs.question === "What is 2 + 2?" ? "4" : "unknown",
});

const exactAnswer = ({
  outputs,
  referenceOutputs,
}: {
  outputs: Record<string, unknown>;
  referenceOutputs?: Record<string, unknown>;
}) => ({
  key: "exact_answer",
  score: outputs.answer === referenceOutputs?.answer,
});

const results = await evaluate(target, {
  data: "Sample dataset",
  evaluators: [exactAnswer],
  experimentPrefix: "ts-exact-answer",
  maxConcurrency: 0,
});

console.log(results.experimentName, results.results.length);
```

执行 `npx tsx eval.ts`。TS 入口总是返回 Promise，并在 Promise 完成时提供全部结果。见 S1、S6。

## 4. 核心数据流与对象关系

### 离线流

```text
Dataset
  └─ Example { inputs, reference outputs, attachments }
       └─ target(inputs) ──> Run { outputs | error, child runs }
            ├─ row evaluator(Run, Example) ──> EvaluationResult ──> run Feedback
            └─ all Runs + all Examples
                 └─ summary evaluator(runs, examples) ──> EvaluationResult ──> experiment Feedback

Experiment A + Experiment B [+ more]
  └─ align Runs by reference Example
       └─ comparative evaluator(runs, example)
            └─ scores keyed by run id ──> grouped Feedback + Comparative Experiment
```

Runner 只把同一 Example 的目标输出与参考输出配对。逐行评估器彼此独立，汇总评估器在所有行完成后执行。
`num_repetitions=R` 会把每个 Example 执行 R 次，因此 N 个 Example 产生 N × R 个目标 Run。见 S4、S8。

### 在线与人工反馈流

```text
Production trace or thread
  ├─ filter + sampling ──> online Judge / code evaluator ──> Feedback
  ├─ composite evaluator reads constituent feedback ──> aggregate Feedback
  ├─ inline annotation ──> human Feedback
  └─ annotation queue
       ├─ rubric submission ──> human Feedback
       ├─ corrected input/output ──> Dataset Example
       └─ UI Assertion rows ──> Dataset Example.outputs.assertions
                                      └─ later offline evaluator checks each claim
```

在线评估器通常没有参考输出。绑定数据集的评估器可读取 Example；它只作用于配置完成后创建的新实验。
在线评估命中 trace 时可能提升其保留期，项目设置可以选择不提升。见 S11、S13。

### 对象关系中的三个易混点

1. `EvaluationResult` 是评估器回调的返回协议，`Feedback` 是服务端保存的数据。
2. `score` 是数值或布尔量，不等于测试通过。阈值与失败动作属于调用方。
3. Assertions 是数据集参考输出的一种约定形状。它不会自动选择 Judge，也不会自动生成最终分数。

## 5. 完整 API catalog

### 5.1 共同返回与失败语义

所有离线自定义评估器最终都要产生一个或多个带 `key` 的评价结果。
`key` 是 feedback 指标名；`score` 用于布尔或数值；`value` 用于非数值展示；`comment` 用于解释。

| 情形 | Python SDK | TypeScript SDK | OpenEvals |
| --- | --- | --- | --- |
| 单结果 | `EvaluationResult`、字典、布尔、数值或字符串 | `EvaluationResult` | `EvaluatorResult` |
| 多结果 | 字典列表或 `EvaluationResults` | 结果数组或 `EvaluationResults` | 某些评估器可返回结果列表 |
| 无分 | `score=None` 合法，也可只给 `value` 或 `comment` | `score` 可省略或为 `null` | 标准结果要求布尔或数值 `score` |
| 跳过 | 没有一等 `skip` 返回值 | 没有一等 `skip` 返回值 | 没有一等 `skip` 返回值 |
| 返回 `None` | 无效；归一化时失败 | 不符合公开类型 | 不符合公开类型 |
| 逐行评估器抛错 | 能推断静态 key 时写无分错误 feedback；否则只输出错误信息 | 输出错误信息并省略该 feedback | 抛给调用者 |
| 汇总评估器抛错 | 输出错误信息并省略该汇总结果 | 输出错误信息并省略该汇总结果 | 由调用方处理 |
| 比较评估器抛错 | 比较调用抛错 | 比较 Promise 拒绝 | 由调用方处理 |
| 目标函数抛错 | `error_handling="log"` 保留错误 Run；`"ignore"` 忽略该 Run | 错误进入 runner 的失败路径；无对应选项 | 不负责目标执行 |

这些行为来自固定 SDK runner 与 evaluator，见 S4 至 S7、S10。
没有分数不等于跳过，缺少 feedback 也不等于通过。产品没有为这三种状态提供统一判定代数。

### 5.2 Python 离线执行入口

0.10.17 的主入口是同步客户端上的 `evaluate` 与异步方法 `aevaluate`。
模块顶层也导出同名函数；`langsmith.evaluation` 的动态导入面自 0.5.0 标为弃用，官方引导使用客户端方法。

```python
Client.evaluate(
    target, /,
    data=None,
    evaluators=None,
    summary_evaluators=None,
    metadata=None,
    experiment_prefix=None,
    description=None,
    max_concurrency=0,
    num_repetitions=1,
    blocking=True,
    experiment=None,
    upload_results=True,
    error_handling="log",
    **kwargs,
) -> ExperimentResults | ComparativeExperimentResults

await Client.aevaluate(
    target, /,
    data=None,
    evaluators=None,
    summary_evaluators=None,
    metadata=None,
    experiment_prefix=None,
    description=None,
    max_concurrency=0,
    num_repetitions=1,
    blocking=True,
    experiment=None,
    upload_results=True,
    error_handling="log",
    **kwargs,
) -> AsyncExperimentResults
```

| 参数 | 接受值、默认值与作用 |
| --- | --- |
| `target` | `dict -> dict` 函数、LangChain Runnable、既有实验名/ID，或两个实验的 tuple。同步入口拒绝异步 target。 |
| `data` | 数据集名、Example 列表或生成器。新实验必填；既有实验再评分时省略。异步入口也接受异步迭代器。 |
| `evaluators` | 逐行评估器序列。比较 target 时改为比较评估器序列。默认 `None`。 |
| `summary_evaluators` | 全数据集评估器序列。比较两个实验时不可传。默认 `None`。 |
| `metadata` | 写到实验的字典。默认 `None`。 |
| `experiment_prefix` | 自动生成实验名的前缀。默认 `None`。 |
| `description` | 实验说明。默认 `None`。 |
| `max_concurrency` | `0` 顺序执行，正数限制并发，`None` 不设上限。默认 `0`。 |
| `num_repetitions` | 每个 Example 的执行次数。默认 `1`。 |
| `blocking` | 默认 `True`。为 `False` 时后台继续，调用方可迭代流式结果或调用 `wait()`。 |
| `experiment` | 把新 Run 加入既有实验的高级选项。与部分命名选项互斥。默认 `None`。 |
| `upload_results` | 默认 `True`。`False` 是仅供新实验使用的 beta 本地执行面，不写服务端。 |
| `error_handling` | `"log"` 保留目标错误 Run；`"ignore"` 完全忽略该目标 Run。默认 `"log"`。 |

完整签名、互斥条件和默认值见 S4。

#### 同族入口

| API | 同步性 | 参数与返回 | 状态 |
| --- | --- | --- | --- |
| `langsmith.evaluate(target, /, data=None, evaluators=None, summary_evaluators=None, metadata=None, experiment_prefix=None, description=None, max_concurrency=0, num_repetitions=1, client=None, blocking=True, experiment=None, upload_results=True, error_handling="log", **kwargs)` | 同步 | 与 `Client.evaluate` 相同，多一个 `client`；返回同步结果对象 | 顶层导出 |
| `langsmith.aevaluate(target, /, data=None, evaluators=None, summary_evaluators=None, metadata=None, experiment_prefix=None, description=None, max_concurrency=0, num_repetitions=1, client=None, blocking=True, experiment=None, upload_results=True, error_handling="log", **kwargs)` | 异步 | 与 `Client.aevaluate` 相同，多一个 `client`；返回异步结果对象 | 顶层导出 |
| `evaluate_existing(experiment, /, evaluators=None, summary_evaluators=None, metadata=None, max_concurrency=0, client=None, load_nested=False, blocking=True)` | 同步 | 读取既有 Run，不再次调用目标；返回 `ExperimentResults` | 兼容入口，官方示例改用 `evaluate(experiment, evaluators=[evaluator])` |
| `aevaluate_existing(experiment, /, evaluators=None, summary_evaluators=None, metadata=None, max_concurrency=0, client=None, load_nested=False, blocking=True)` | 异步 | 与上一项同义；返回 `AsyncExperimentResults` | 兼容入口 |
| `evaluate_comparative(experiments, /, evaluators, experiment_prefix=None, description=None, max_concurrency=5, client=None, metadata=None, load_nested=False, randomize_order=False)` | 同步 | 至少两个同数据集实验；返回 `ComparativeExperimentResults` | 独立比较入口 |

`aevaluate` 不支持比较实验。需要比较时使用同步入口。
再评分只运行新评估器，不再次调用应用，因此适合修改 rubric 后重算 feedback。见 S4、S9。

#### Python 结果对象

| 类型 | 可读面 |
| --- | --- |
| `ExperimentResults` | `experiment_name`、`experiment_id`、`url`、`comparison_url`、`get_dataset_id()`、`wait()`、`len()`、迭代与 `to_pandas()`。 |
| 每个结果行 | `run`、`example`、`evaluation_results`。 |
| `AsyncExperimentResults` | 异步迭代、异步 `wait()`、`to_pandas()`、`get_dataset_id()`、`get_comparison_url()`，另有实验名、ID 与 URL。 |
| `ComparativeExperimentResults` | 迭代每个共同 Example 的比较结果，支持按 Example ID 取值，并提供 `url` 与 `comparative_experiment`。 |

### 5.3 TypeScript 离线执行入口

```ts
declare function evaluate(
  target: TargetT,
  options: EvaluateOptions | ComparativeEvaluateOptions,
): Promise<ExperimentResults | ComparisonEvaluationResults>
```

标准 target 是同步或异步函数 `(input, config?) => output`，也可以是带 `invoke` 的对象。
比较 target 是两个或更多实验名，或已完成的 `ExperimentResults` 数组。见 S6。

| 标准 `EvaluateOptions` | 默认值与作用 |
| --- | --- |
| `data` | 必填；数据集名、`Example[]` 或异步 Example 迭代器。 |
| `evaluators` | 逐行评估器数组。默认省略。 |
| `summaryEvaluators` | 汇总评估器数组。默认省略。 |
| `metadata`、`experimentPrefix`、`description`、`client` | 实验或客户端配置。默认省略。 |
| `maxConcurrency` | 共用并发限制。未提供时 runner 按串行队列运行。 |
| `targetConcurrency` | 单独限制目标调用；省略时继承 `maxConcurrency`。 |
| `evaluationConcurrency` | 单独限制评估器；省略时继承 `maxConcurrency`。 |
| `numRepetitions` | 每个 Example 的次数。默认 `1`。 |
| `includeAttachments` | 是否向 target 与评估器提供附件。默认 `false`。 |

| `ComparativeEvaluateOptions` | 默认值与作用 |
| --- | --- |
| `evaluators` | 必填的比较评估器数组。 |
| `randomizeOrder` | 是否在每个 Example 内打乱 Run 顺序。默认 `false`。 |
| `loadNested` | 是否加载子 Run。默认 `false`。 |
| `maxConcurrency` | 比较评估器并发限制。默认省略。 |
| 其余 | `client`、`metadata`、`experimentPrefix` 与 `description` 均可省略。 |

Promise 完成时，标准结果提供 `experimentName`、`results`、`summaryResults`、`processedCount` 与 `length`。
它也实现异步迭代，但公开函数会先完成全部处理，Promise 才会完成。比较结果还提供 `url` 与 `comparativeExperiment`。

`evaluateComparative(experiments, options)` 仍公开，但标为弃用。
替代写法是 `evaluate([experimentA, experimentB], options)`。两者都要求至少两个实验且引用同一数据集。见 S6。

### 5.4 自定义评估器协议

#### Python 逐行评估器

函数可同步或异步，并可按名字声明以下任意子集：

```python
def evaluator(
    run=None,
    example=None,
    inputs=None,
    outputs=None,
    reference_outputs=None,
    attachments=None,
):
    pass
```

runner 按参数名注入值。旧式任意两个位置参数被当作 `run, example`，只用于兼容。
普通 `evaluate` 可接同步回调；`aevaluate` 可混用同步和异步回调。见 S5。

| 返回形状 | 归一化结果 |
| --- | --- |
| `bool`、`int`、`float` | 函数名成为 `key`，返回值成为 `score`。 |
| `str` | 函数名成为 `key`，返回值成为 `value`。 |
| 字典 | `key` 可省略，此时采用函数名；至少要有 `score`、`value` 或 `comment`。 |
| 字典列表 | 一次返回多个指标；每项要能归一化为 `EvaluationResult`。 |
| `EvaluationResult` | 原样采用字段，并补齐评估器追踪信息。 |
| `EvaluationResults(results=results)` | `results` 是 `EvaluationResult` 列表；一次返回多个强类型结果。 |

`EvaluationResult` 的完整公开字段如下：

```python
EvaluationResult(
    key: str,
    score: bool | int | float | None = None,
    value: dict | str | bool | int | float | None = None,
    metadata: dict | None = None,
    comment: str | None = None,
    correction: dict | None = None,
    evaluator_info: dict = {},
    feedback_config: FeedbackConfig | dict | None = None,
    source_run_id: UUID | str | None = None,
    target_run_id: UUID | str | None = None,
    extra: dict | None = None,
)
```

数值应放在 `score`；把数值放进 `value` 会触发警告。
`target_run_id` 可把评价指向子 Run；`source_run_id` 可链接生成该评价的 Judge trace。见 S5。

`RunEvaluator` 的直接作者面如下：

- `RunEvaluator.evaluate_run(run, example=None, evaluator_run_id=None)` 是同步抽象入口；
- `RunEvaluator.aevaluate_run(run, example=None, evaluator_run_id=None)` 是异步入口，默认可调用同步实现；
- `feedback_keys` 返回静态可知的 key，默认尽力从内部 evaluator 名称取得；
- `@run_evaluator` 把函数包装为 `DynamicRunEvaluator`。

两个 Client 单 Run 方法的完整签名如下：

```python
Client.evaluate_run(
    run,
    evaluator,
    *,
    project_id=None,
    start_time=None,
    source_info=None,
    reference_example=None,
    load_child_runs=False,
) -> EvaluationResult

await Client.aevaluate_run(
    run,
    evaluator,
    *,
    project_id=None,
    start_time=None,
    source_info=None,
    reference_example=None,
    load_child_runs=False,
) -> EvaluationResult
```

run 可为 V2 Run、旧 Run 对象、ID 或 UUID；reference example 也可为对象、字典或 ID。
方法执行 evaluator 并写 feedback；多结果时都会写入，但返回列表中的第一项。
两个方法将于 2027-01-31 后移除；`load_child_runs` 也已单独弃用。
官方替代方式是直接运行 evaluator，再调用 `create_feedback`，而不是另一个单 Run convenience API。见 S17。

#### TypeScript 逐行评估器

推荐形状是单对象参数；旧的 `(run, example?)` 形状标为弃用。

```ts
type EvaluatorT = (args: {
  run: Run;
  example: Example;
  inputs: Record<string, any>;
  outputs: Record<string, any>;
  referenceOutputs?: Record<string, any>;
  attachments?: Record<string, any>;
}) => EvaluationResult | EvaluationResult[] | EvaluationResults
   | Promise<EvaluationResult | EvaluationResult[] | EvaluationResults>;
```

```ts
type EvaluationResult = {
  key: string;
  score?: number | boolean | null;
  value?: number | boolean | string | object | null;
  comment?: string;
  correction?: Record<string, unknown>;
  evaluatorInfo?: Record<string, unknown>;
  sourceRunId?: string;
  targetRunId?: string;
  feedbackConfig?: FeedbackConfig;
};
```

TS 没有 Python 结果对象的 `metadata` 与 `extra` 字段。
公开的 `RunEvaluator.evaluateRun(run, example?, options?)` 总是返回 Promise；函数回调可以同步。见 S6、S7。

#### 弃用与 legacy 类评估器

Python 0.10.17 仍公开两个类，但二者自 0.5.0 标为弃用，官方替代方案是 OpenEvals。见 S20。

| API | 配置、调用与返回 | 状态 |
| --- | --- | --- |
| Python `StringEvaluator(*, evaluation_name=None, input_key="input", prediction_key="output", answer_key="output", grading_function)` | `grading_function(input, prediction, answer)` 必传并返回字典。结果或 `evaluation_name` 要提供 key；两者都没有时校验失败。同步返回 `EvaluationResult`；目标无 outputs 时抛错。 | 弃用。 |
| TS `new StringEvaluator({evaluationName?, inputKey?, predictionKey?, answerKey?, gradingFunction})` | 三个 key 的默认值与 Python 相同。`gradingFunction({input, prediction, answer})` 必传且异步；它须返回 key，或由 `evaluationName` 提供 key。 | 0.8.9 仍公开，固定源码没有弃用标记。 |
| Python `LLMEvaluator(*, prompt_template, score_config, map_variables=None, model_name="gpt-4o", model_provider="openai", **kwargs)` | prompt 接字符串或 `(role, template)` 列表；score config 必传。`map_variables(run, example)` 返回模板变量字典；额外参数交给模型初始化。提供同步和异步单 Run 方法。 | 同时带 beta 警告与弃用说明。 |
| Python `LLMEvaluator.from_model(model, *, prompt_template, score_config, map_variables=None)` | 接收支持结构化输出的 LangChain chat model；其余参数形状同上一项，返回 `LLMEvaluator`。 | 同上。 |

`CategoricalScoreConfig(key, choices, description, include_explanation=False, explanation_description=None)` 把选择写入 `value`。
`ContinuousScoreConfig(key, description, min=0, max=1, include_explanation=False, explanation_description=None)` 把数值写入 `score`。

两种 config 都把可选解释写入 `comment`。默认变量名只有 `input`、`output` 与 `expected`。
prompt 使用其他变量，或输入、输出含多个字段时，作者必须传 `map_variables`。

#### 汇总评估器

Python 汇总函数是同步函数。它可按名字声明 `runs`、`examples`、`inputs`、`outputs`、`reference_outputs` 的任意子集。
返回形状与逐行评估器相同，写入 Experiment 级 feedback，而不是某个 Run。见 S2、S4。

```python
def summary(
    runs=None,
    examples=None,
    inputs=None,
    outputs=None,
    reference_outputs=None,
) -> dict | list[dict] | EvaluationResult | EvaluationResults:
    pass
```

TS 汇总函数可同步或异步。推荐单对象参数；旧 `(runs, examples)` 形状标为弃用。

```ts
type SummaryEvaluatorT = (args: {
  runs: Run[];
  examples: Example[];
  inputs: Record<string, any>[];
  outputs: Record<string, any>[];
  referenceOutputs?: Record<string, any>[];
}) => EvaluationResult | EvaluationResult[] | EvaluationResults
   | Promise<EvaluationResult | EvaluationResult[] | EvaluationResults>;
```

汇总评估器只用于离线完整数据集。在线组合分数是另一种机制，不会收到全部 Run。见 S2。

#### 比较评估器

Python 回调可按名字取 `runs`、`example`、`inputs`、`outputs` 与 `reference_outputs`。
它可同步或异步，但比较 runner 本身同步。

```python
ComparisonEvaluationResult(
    key: str,
    scores: dict[run_id, bool | int | float | None],
    source_run_id: UUID | str | None = None,
    comment: str | dict[run_id, str] | None = None,
)
```

Python 也接受 `list[bool | int | float | None]`。runner 用 `zip(runs, result)` 按位置建分数字典，函数名成为 feedback key。
短列表会漏掉尾部 Run，长列表的多余项会被忽略；SDK 不验证列表长度。
对象形状适合显式 key、逐 Run comment 或关联的 evaluator Run ID。见 S8。

TS 推荐形状如下；旧 `(runs, example)` 标为弃用。

```ts
type ComparativeEvaluator = (args: {
  runs: Run[];
  example: Example;
  inputs: Record<string, any>;
  outputs: Record<string, any>[];
  referenceOutputs?: Record<string, any>;
}) => {
  key: string;
  scores: Record<string, number | boolean | null>;
  source_run_id?: string;
} | Promise<{
  key: string;
  scores: Record<string, number | boolean | null>;
  source_run_id?: string;
}>;
```

两端都把 `scores` 中的每个 Run ID 写成同一组比较 feedback。
TS 会拒绝不属于本组的 Run ID，但允许省略本组中的 Run；Python 没有相同的本地 ID 校验。
值为 `None` 或 `null` 时写无分 feedback，不代表跳过。
`randomize_order` 或 `randomizeOrder` 可降低固定左右顺序带来的偏差。见 S4、S8。

Python 还公开深层导入 `langsmith.evaluation.evaluator.comparison_evaluator`。
这个装饰器把回调包装为 `DynamicComparisonRunEvaluator`，提供同步 `compare_runs(runs, example=None)` 和异步 `acompare_runs(runs, example=None)`。
它不在 `langsmith.evaluation.__all__` 中；一般作者直接把函数传给 runner 即可。见 S5。

作者也可只创建比较实验容器，不立即运行比较评估器：

```python
Client.create_comparative_experiment(
    name,
    experiments,
    *,
    reference_dataset=None,
    description=None,
    created_at=None,
    metadata=None,
    id=None,
) -> ComparativeExperiment
```

```ts
interface Client {
  createComparativeExperiment(options: {
    name: string;
    experimentIds: string[];
    referenceDatasetId?: string;
    createdAt?: Date;
    description?: string;
    metadata?: Record<string, unknown>;
    id?: string;
  }): Promise<ComparativeExperiment>;
}
```

两个方法都只在本地要求实验列表非空；比较 runner 才要求至少两个实验。
省略数据集时，客户端从第一个实验读取关联数据集。
Python 省略 `id` 与 `created_at` 时分别生成 UUID 与 UTC 时间；TS 省略 `createdAt` 时使用当前时间，`id` 交给服务端处理。
这些方法只创建容器，不对齐 Run、不调用评估器，也不写分数。见 S17、S18。

比较回调抛错时，两端都会让比较调用失败，不会把该异常变成跳过或无分结果。
Python 在并发路径通过 `Future.result()` 重新抛出；TS 的比较 Promise 会拒绝。见 S4、S6。

### 5.5 OpenEvals 0.2.0

OpenEvals 是官方独立包，也是 LangSmith 文档推荐的预制评估器路径。
Python 回调接收 `inputs`、`outputs`、`reference_outputs`；TS 具体工厂接收 `inputs`、`outputs`、`referenceOutputs`。
两端都返回下列协议。见 S1、S10。

| 能力 | Python 导入路径 | TypeScript 导入路径 |
| --- | --- | --- |
| exact、通用 Judge、trajectory 工厂 | `openevals` 顶层；对应模块是 `openevals.exact`、`openevals.llm`、`openevals.trajectory` | `openevals` 顶层 |
| Levenshtein、embedding | `openevals.string` | `openevals` 顶层 |
| JSON matcher | `openevals.json` | `openevals` 顶层 |
| Code Judge | `openevals.code.llm` | `openevals` 顶层 |
| 本机代码检查 | `openevals.code.pyright`、`openevals.code.mypy` | `openevals/code/typescript` |
| E2B 代码检查与执行 | `openevals.code.e2b.pyright`、`openevals.code.e2b.execution` | `openevals/code/e2b` |
| prompt 常量 | `openevals.prompts`；JSON 的两个常量在 `openevals.json` | `openevals/prompts` 或 `openevals` 顶层 |

```python
class EvaluatorResult(TypedDict):
    key: str
    score: float | bool
    comment: str | None
    metadata: dict | None
    source_run_id: str | None
```

TS 使用 camelCase 的 `sourceRunId`。
0.2.0 导出的 TS `SimpleEvaluator` 类型却把参考字段写成 `reference_outputs`，与具体工厂和 LangSmith runner 不一致。
直接接入 LangSmith 时应使用具体工厂声明的 `referenceOutputs`。
OpenEvals 不提供 `None` 分数、跳过结果或共同的错误结果对象。
具体评估器抛出的输入、配置与 Judge 异常会直接交给调用方。

OpenEvals 的 `metadata` 不等于 Feedback 字段。
Python OpenEvals 会把它合入当前 evaluator trace；Python feedback 写入路径不复制 `EvaluationResult.metadata`。
TS LangSmith 的结果类型没有该字段，`logEvaluationFeedback` 也不会把 OpenEvals `metadata` 写进 Feedback。见 S5、S7、S10、S17、S18。

TS 包还公开两组低层 scorer 类型与一个同步归一化函数：

| API | 完整协议 |
| --- | --- |
| `SingleResultScorerReturnType` | `boolean \| number \| [boolean \| number, string, metadata?]`；tuple 第二项是 reasoning。 |
| `MultiResultScorerReturnType` | `{[key]: boolean \| number \| {score, reasoning?, sourceRunId?}}`。 |
| `LLMAsJudgeScorer` | `(params: {inputs?, outputs?, referenceOutputs?, [key: string]: unknown}) => Promise<SingleResultScorerReturnType>`。 |
| `EvaluationResultType<O>` | 条件类型；多结果 scorer 映射为 `EvaluatorResult[]`，其他 scorer 映射为单个 `EvaluatorResult`。 |
| `processScore(_key, value)` | 从 `openevals/utils` 导入。原始值返回 `[score]`；对象返回 `[score, reasoning?, metadata?, sourceRunId?]`。对象缺少 `score` 时同步抛错；首个参数在 0.2.0 中未使用。 |
| `isZodSchema(input?)` | 从 `openevals/llm` 导入。同步检查输入是否有 `parse` 函数，并作为 Zod type guard 返回布尔值。 |

这些导出不写 feedback，也不执行 Judge。Python 没有同名公开归一化函数。

| TS 子路径 | 0.2.0 的内部导出 |
| --- | --- |
| `openevals/utils` | `_convertToOpenAIMessage`、`_normalizeToOpenAIMessagesList`、`_normalizeContentBlocks`、`_attachmentToContentBlock`、`_runEvaluator`、`_runEvaluatorUntyped`、`_normalizeOutputsAsString` |
| `openevals/llm` | `_createLLMAsJudgeScorer` |

下划线与源码把这些名字标为内部层，本文不把它们作为稳定扩展点。

`run_multiturn_simulation`、`runMultiturnSimulation` 与 simulated-user 工厂只生成对话轨迹，不计算分数。
它们不属于本文的 scorer catalog；生成后的轨迹仍可交给本节的 trajectory evaluator。

#### 确定性与结构化输出评估器

| Python / TypeScript API | 配置与默认值 | 输入、返回与同步性 |
| --- | --- | --- |
| `exact_match`、`exact_match_async` / `exactMatch` | 无配置 | 比较 JSON 序列化后的深层相等；key 为 `exact_match`，布尔分数。Python 各有同步、异步版；TS 异步。 |
| `levenshtein_distance`、`levenshtein_distance_async` / `levenshteinDistance` | 无配置 | 非字符串先转 JSON；返回 `1 - distance / max_length`，key 为 `levenshtein_distance`。Python 双版；TS 异步。 |
| `create_embedding_similarity_evaluator`、`create_async_embedding_similarity_evaluator` / `createEmbeddingSimilarityEvaluator` | Python：`model="openai:text-embedding-3-small"`，`algorithm="cosine"`。TS 必传 embeddings，算法默认 `cosine`；两端另一个值都是 `dot_product`。 | 比较输出与参考输出，key 为 `embedding_similarity`。两端分数保留两位；Python 双版，TS 异步。 |
| `create_json_match_evaluator`、`create_async_json_match_evaluator` / `createJsonMatchEvaluator` | `aggregator=None`、`list_aggregator="all"`、`rubric={}`、`exclude_keys=[]`、`judge=None`、`model=None`、`use_reasoning=True`、`list_match_mode="same_elements"`。TS 使用 camelCase。 | 无 rubric 的字段做精确比较；rubric 字段交给 Judge。Python 双版；TS 异步。 |

Python 的 exact、Levenshtein 与 embedding 评估器会拒绝 `None` 输入。
TS embedding 同时拒绝 `null` 与 `undefined`；TS exact 只显式拒绝 `null`，省略普通参考输出会得到 false。
TS Levenshtein 也只先检查 `null`，省略参考输出随后会因字符串长度读取失败而拒绝 Promise。
`createJsonMatchEvaluator` 的 options 对象本身必传；无配置时要写 `{}`。

JSON matcher 的所有枚举值如下：

- `aggregator`：`None`、`"average"`、`"all"`；
- `list_aggregator`：`"average"`、`"all"`；
- `list_match_mode`：`"same_elements"`、`"ordered"`、`"subset"`、`"superset"`。

| `list_match_mode` | 列表配对语义 |
| --- | --- |
| `same_elements` | 输出每项都要在参考列表找到匹配，参考每项也要在输出列表找到匹配。 |
| `ordered` | 按索引配对。 |
| `subset` | 输出列表的每项都要在参考列表找到匹配。 |
| `superset` | 参考列表的每项都要在输出列表找到匹配。 |

没有 `aggregator` 时，每个字段返回 `json_match:<field>`。
使用 `average` 或 `all` 时，key 分别是 `json_match:average` 与 `json_match:all`；列表聚合先在同一字段内合并。见 S10。
输出与参考输出一端是列表、另一端不是列表时抛错。
非空 rubric 必须同时提供 judge 或 model；空 rubric 则禁止提供二者。
违反组合约束会在创建工厂时抛错。

#### 通用 LLM-as-Judge

```python
create_llm_as_judge(
    *,
    prompt,
    feedback_key="score",
    judge=None,
    model=None,
    system=None,
    continuous=False,
    choices=None,
    use_reasoning=True,
    few_shot_examples=None,
    output_schema=None,
) -> SimpleEvaluator | Callable

create_async_llm_as_judge(
    *,
    prompt,
    feedback_key="score",
    judge=None,
    model=None,
    system=None,
    continuous=False,
    choices=None,
    use_reasoning=True,
    few_shot_examples=None,
    output_schema=None,
) -> SimpleAsyncEvaluator | Callable
```

TS 签名使用同义 camelCase 字段：

```ts
interface LLMJudgeOptions {
  prompt: string | RunnableInterface | MessageFactory;
  feedbackKey?: string;
  judge?: ModelClient | BaseChatModel;
  model?: string;
  system?: string;
  continuous?: boolean;
  choices?: number[];
  useReasoning?: boolean;
  fewShotExamples?: FewShotExample[];
  outputSchema?: Record<string, unknown> | ZodObjectAny;
}

declare function createLLMAsJudge(
  options: LLMJudgeOptions,
): (params: Record<string, unknown>) => Promise<EvaluatorResult | Record<string, unknown>>;
```

`MessageFactory` 是同步或异步生成 `ChatCompletionMessage[]` 的函数。
TS 创建的评估器总是异步。
`prompt` 可为模板、Runnable 或生成消息的函数；模板变量来自评估器调用参数。见 S10。

创建后的评估器接 `inputs`、`outputs`、参考输出与任意额外 prompt 变量。
`attachments` 可传图片 URL，或带 `mime_type` 和 `data` 的图片、PDF、音频对象；prompt 中的 `{attachments}` 决定插入位置。
不支持的 MIME type 或缺少数据字段会抛错。见 S10。

| 选项 | 准确语义 |
| --- | --- |
| `judge` | OpenAI 风格 client 或 LangChain chat model。省略时由 `model` 初始化。 |
| `model` | 模型标识；直接传 OpenAI client 时也用它指定模型。 |
| `continuous` | 默认 `False`，返回布尔分数；为 `True` 时采用文档约定的 0 到 1 连续分数。0.2.0 schema 没有 `minimum` 或 `maximum`，SDK 也不做范围校验。 |
| `choices` | 可选数值集合，要求 Judge 从集合中选择。 |
| `use_reasoning` | 默认 `True`，把解释放入 `comment`。 |
| `few_shot_examples` | 每项含 inputs、outputs、score 与可选 reasoning。默认无。 |
| `output_schema` / `outputSchema` | Python 可传 JSON Schema、Pydantic model 或 TypedDict；TS 可传 JSON Schema 或 Zod schema。使用后返回原始结构化对象，不再自动生成标准结果。 |

默认输出 key 是 `score`。Judge 调用或结构化输出校验失败时会抛错，不会返回无分结果。
judge 与 model 不能同时省略；直接传 OpenAI client 仍要用 model 指定模型名。
官方 README 规定 `continuous` 与 `choices` 互斥；0.2.0 工厂没有主动拒绝两者并存，此时 `choices` 分支优先。
作者应只传其中一个，避免把源码优先级当成契约。
自定义 output schema 不能再配带 schema 的 StructuredPrompt；few-shot 需要 prompt 中有 user 消息。
TS 的 system 只支持字符串 prompt。违反这些约束会在创建或首次调用时抛错。见 S10。

#### 轨迹评估器

轨迹输入可为 OpenAI 消息、LangChain 消息，或带 `messages` 的字典。
匹配器要求输出与参考轨迹；Judge 的参考轨迹可省略。见 S10。

| Python / TypeScript API | 完整配置 | 返回与同步性 |
| --- | --- | --- |
| `create_trajectory_match_evaluator`、`create_async_trajectory_match_evaluator` / `createTrajectoryMatchEvaluator` | `trajectory_match_mode="strict"`、`tool_args_match_mode="exact"`、`tool_args_match_overrides=None` | key 为 `trajectory_<mode>_match`，布尔分数。Python 双版；TS 异步。 |
| `create_trajectory_llm_as_judge`、`create_async_trajectory_llm_as_judge` | `prompt=TRAJECTORY_ACCURACY_PROMPT_WITH_REFERENCE`、`model=None`、`feedback_key="trajectory_accuracy"`、`judge=None`、`continuous=False`、`choices=None`、`use_reasoning=True`、`few_shot_examples=None` | 返回 Judge 结果。Python 有同步和异步工厂。 |
| `createTrajectoryLLMAsJudge` | `{prompt?, feedbackKey?, model?, judge?, system?, schema?, continuous?, choices?, useReasoning?, fewShotExamples?}={}`；prompt 与 key 默认值同 Python | 创建异步评估器；输入要求 `outputs`，参考轨迹可省略。`schema` 接 JSON Schema 或 Zod schema。 |

TS 不传 `schema` 时返回标准 `EvaluatorResult`。
0.2.0 的类型虽接受 `schema`，实现却没有启用 generic Judge 的 raw-output 路径，公开返回类型仍是单个 `EvaluatorResult`。
本文不把这个类型泄漏当作稳定的自定义结果协议。见 S10。

两端在没有参考轨迹时仍保留默认的 `TRAJECTORY_ACCURACY_PROMPT_WITH_REFERENCE`，只把参考字符串设为空。
要做无参考 Judge，作者应显式传 `TRAJECTORY_ACCURACY_PROMPT`，不能期待工厂自动切换 prompt。

`trajectory_match_mode` 的全部值是 `strict`、`unordered`、`subset`、`superset`。
`tool_args_match_mode` 的全部值是 `exact`、`ignore`、`subset`、`superset`。

| `trajectory_match_mode` | 工具调用关系 |
| --- | --- |
| `strict` | 消息数量与 role 按位置相同；每个位置的工具调用集合相同。 |
| `unordered` | 两边的工具调用多重集合相同，不看消息位置。 |
| `subset` | 输出中的工具调用都能在参考轨迹中找到。 |
| `superset` | 参考轨迹中的工具调用都能在输出中找到。 |

| `tool_args_match_mode` | 参数判定 |
| --- | --- |
| `exact` | 两份参数字典完全相同。 |
| `ignore` | 只要工具名匹配就接受参数。 |
| `subset` | 输出参数的每个键和值都存在于参考参数。 |
| `superset` | 参考参数的每个键和值都存在于输出参数。 |

`tool_args_match_overrides` 按工具名覆写全局策略。
每项可为上述模式、要比较的参数名列表，或接收两份参数字典的自定义比较函数。
参数名列表支持用点号读取嵌套字典。
Python 自定义函数同步返回布尔值；TS 函数可返回布尔值或 Promise。

strict 模式比较消息数量、各位置 role、tool call 数量、工具名与参数。
它不比较普通 message content、tool call ID、tool result 内容或最终回答文字。
unordered、subset 与 superset 只提取 tool calls，再比较工具名与参数集合。
因此确定性 trajectory matcher 证明的是工具调用路径；回答内容要用另一个 evaluator 检查。见 S10。

0.2.0 还保留八个 Python 深层导入，但调用时都会发出 `DeprecationWarning`：

| 弃用 API | 参数、返回与替代 |
| --- | --- |
| `trajectory_strict_match`、`trajectory_strict_match_async` | 必传 `outputs` 与 `reference_outputs`；`tool_call_args_exact_match=True`。返回 key `trajectory_strict_match`；改用 strict 工厂。 |
| `trajectory_unordered_match`、`trajectory_unordered_match_async` | 必传两份轨迹，固定忽略工具参数差异；返回 key `trajectory_unordered_match`。改用 unordered 工厂。 |
| `trajectory_subset`、`trajectory_subset_async` | 必传两份轨迹，固定忽略工具参数差异；返回 key `trajectory_subset`。改用 subset 工厂。 |
| `trajectory_superset`、`trajectory_superset_async` | 必传两份轨迹，固定忽略工具参数差异；返回 key `trajectory_superset`。改用 superset 工厂。 |

同步函数直接返回 `EvaluatorResult`，异步函数要 `await`。
这些名字不由 `openevals` 或 `openevals.trajectory` 顶层重导出；固定源码中的替代说明指向对应工厂。见 S10。

#### 代码评估器

所有代码评估器都接受三种提取策略：`none`、`llm`、`markdown_code_blocks`。
默认 `none` 直接使用输出。
自定义 `code_extractor` 只能配 `none`；同时传非 `none` 策略会抛错。
`llm` 提取要求 `model` 或 `client`，找不到代码时返回 false 与 `code_extraction_failed` 元数据。
Markdown 策略找不到代码时也返回同一失败结果，不会抛出 skip。见 S10。

| API | 配置重点 | feedback key 与执行方式 |
| --- | --- | --- |
| Python `create_code_llm_as_judge`、`create_async_code_llm_as_judge` | `prompt` 必填；`feedback_key="code_correctness"`；`code_extraction_strategy="none"`、`code_extractor=None`；`judge=None`、`model=None`、`system=None`、`continuous=False`、`choices=None`、`use_reasoning=True`、`few_shot_examples=None` | Judge 评价代码；同步、异步各一版。 |
| TS `createCodeLLMAsJudge` | `prompt` 必填；可传 `feedbackKey`、`codeExtractionStrategy`、`codeExtractor`、`judge`、`model`、`system`、`continuous`、`choices`、`useReasoning`、`fewShotExamples`、`outputSchema`、`client` | 默认 key 为 `code_correctness`；创建异步 Judge 评估器。`client` 供提取步骤使用。0.2.0 类型虽继承 `outputSchema`，实现没有把它映射给 scorer，因此该字段被忽略。 |
| Python `create_pyright_evaluator`、`create_async_pyright_evaluator` | `pyright_cli_args=[]`、`code_extraction_strategy="none"`、`code_extractor=None`、`client=None`、`model=None` | 本机 Pyright；key 为 `pyright_succeeded`。 |
| Python `create_mypy_evaluator`、`create_async_mypy_evaluator` | `mypy_cli_args` 默认含 `--no-incremental`、`--disallow-untyped-calls`、`--disallow-incomplete-defs`、`--ignore-missing-imports`；`code_extraction_strategy="none"`、`code_extractor=None`、`client=None`、`model=None` | 本机 mypy；key 为 `mypy_succeeded`。 |
| TS `createTypeScriptEvaluator` | 可传 `codeExtractionStrategy`、`codeExtractor`、`model`、`client`；对象可省略，策略默认 `none` | 本机 TypeScript 编译器；key 为 `typescript_succeeded`；异步返回。 |
| Python `create_e2b_pyright_evaluator`、`create_async_e2b_pyright_evaluator` | 必传同步或异步 E2B `Sandbox`；`sandbox_project_directory=None`、`code_extraction_strategy="none"`、`code_extractor=None`、`client=None`、`model=None` | 远端安装依赖并运行 Pyright；key 为 `pyright_succeeded`。 |
| Python `create_e2b_execution_evaluator`、`create_async_e2b_execution_evaluator` | 必传同步或异步 E2B `Sandbox`；`environment_variables=None`、`execution_command="python"`、`sandbox_project_directory=None`、`code_extraction_strategy="none"`、`code_extractor=None`、`client=None`、`model=None` | 远端执行代码；key 为 `execution_succeeded`。 |
| TS `createE2BTypeScriptEvaluator` | 必传 `sandbox`；可传 `sandboxProjectDirectory`、`codeExtractionStrategy`、`codeExtractor`、`model`、`client` | 远端安装依赖并做 TS 检查；key 为 `typescript_succeeded`。 |
| TS `createE2BExecutionEvaluator` | 必传 `sandbox`；可传 `environmentVariables`、`sandboxProjectDirectory`、`codeExtractionStrategy`、`codeExtractor`、`model`、`client` | 远端执行 TS；key 为 `execution_succeeded`。 |

本机静态检查器依赖对应 CLI。E2B 评估器依赖单独的 E2B 包、账号与远端执行费用。
E2B 的 project directory 省略时使用 `openevals`。
Python execution 默认运行 `python outputs.py`；TS execution 固定运行 `npx tsx outputs.ts`，并按 import 安装依赖。
Python 的 async Pyright 与 mypy 工厂允许 `code_extractor` 返回 awaitable；同步工厂与 TS 工厂要求直接返回字符串。

- Pyright、mypy 与本机 TS 发现代码问题时返回 false 与 comment；缺少 Python CLI 会抛错。
- Python E2B 的 `CommandExitException` 返回 false 与 comment；TS E2B 在异常带 stderr 时也这样返回。
- 静态检查和 E2B 工厂只有在提取策略为 `llm` 时才能接 model 或 client；其他组合会在创建时抛错。
- 无效工厂配置、无法连接 Sandbox 与 TS 无 stderr 的 E2B 异常会抛给调用方。
- 代码评估器没有 skip 或无分返回。

#### 官方 prompt 常量

这些常量只是 Judge prompt，不会单独执行。作者仍需传给 Judge 工厂，并选择模型与分数协议。

| 类别 | 0.2.0 的全部公开常量 |
| --- | --- |
| 质量 | `CORRECTNESS_PROMPT`、`CONCISENESS_PROMPT`、`HALLUCINATION_PROMPT`、`ANSWER_RELEVANCE_PROMPT`、`CODE_CORRECTNESS_PROMPT`、`CODE_CORRECTNESS_PROMPT_WITH_REFERENCE_OUTPUTS`、`PLAN_ADHERENCE_PROMPT`、`LAZINESS_PROMPT` |
| RAG | `RAG_GROUNDEDNESS_PROMPT`、`RAG_HELPFULNESS_PROMPT`、`RAG_RETRIEVAL_RELEVANCE_PROMPT` |
| 安全 | `TOXICITY_PROMPT`、`FAIRNESS_PROMPT` |
| 安全攻击 | `PII_LEAKAGE_PROMPT`、`PROMPT_INJECTION_PROMPT`、`CODE_INJECTION_PROMPT` |
| 轨迹 | `TRAJECTORY_ACCURACY_PROMPT`、`TRAJECTORY_ACCURACY_PROMPT_WITH_REFERENCE`、`TOOL_SELECTION_PROMPT` |
| 对话 | `PERCEIVED_ERROR_PROMPT`、`WINS_PROMPT`、`TASK_COMPLETION_PROMPT`、`KNOWLEDGE_RETENTION_PROMPT`、`USER_SATISFACTION_PROMPT`、`AGENT_TONE_PROMPT`、`LANGUAGE_DETECTION_PROMPT`、`SUPPORT_INTENT_PROMPT` |
| 图像 | `EXPLICIT_CONTENT_PROMPT`、`SENSITIVE_IMAGERY_PROMPT` |
| 语音 | `AUDIO_QUALITY_PROMPT`、`TRANSCRIPTION_ACCURACY_PROMPT`、`USER_INTERRUPTS_PROMPT`、`VOCAL_AFFECT_PROMPT` |
| JSON Judge，只有 Python 导出 | `openevals.json.SYSTEM_PROMPT`、`openevals.json.USER_PROMPT`；JSON matcher 内部固定使用，工厂没有替换参数。 |

### 5.6 在线评估器与数据集绑定

在线评估不是把离线 Python 或 TS 回调部署到服务端。
作者在 LangSmith 中创建托管评估器，再用项目、Run filter、sampling rate 与可选 backfill 决定触发范围。见 S11 至 S13。

| 类型 | 作者配置 | 输入与返回 | 限制 |
| --- | --- | --- | --- |
| LLM-as-Judge | prompt、变量映射、模型、feedback key、分数格式、可选 reasoning、filter、sampling 与每周费用上限 | 单个 Run 或整个 thread；写一个 Judge feedback | 托管模型调用；无参考输出时只能依赖 trace 字段与 rubric。 |
| Code | 内联 Python 或 JavaScript `perform_eval(run)`；filter、sampling 与可选 backfill | 返回 `{feedback_key: score}`，一次可写多个 feedback | 无网络；只允许标准库及明确列出的第三方库。 |
| 数据集绑定 Code | `perform_eval(run, example)` | 可读 Example 参考输出；写一个或多个 feedback | 只作用于绑定后创建的新实验。 |
| Composite | `Average` 或 `Sum`、输入 feedback keys 与每项权重 | 写一个组合 feedback | UI 配置；任何组成项缺失时不计算。 |
| Multi-turn Judge | thread、idle time、消息选择、prompt、模型与 feedback config | 每个完成的 thread 执行一次并写 thread feedback | 要求顶层 `messages`；不是逐 Run 评估。 |

在线代码评估器允许 `numpy 2.2.2`、`pandas 1.5.2`、`jsonschema 4.21.1`、`scipy 1.14.1`、`scikit-learn 1.26.4`。
除此之外只能使用语言标准库，且不能访问网络。见 S12。

组合评估器的公式只有两种：

```text
Average = sum(weight_i * score_i) / sum(weight_i)
Sum     = sum(weight_i * score_i)
```

权重默认相等。更新权重会重算已配置 Run 的组合分数；缺少任一组成 feedback 时不生成组合结果。见 S12。

Multi-turn Judge 把 thread 中重叠的消息去重，再生成 OpenAI chat 格式的 `all_messages`。
作者可传全部消息、只传人类与 AI 对，或只传首个人类消息与最后一条 AI 回复。见 S13。

观察日的多轮限制是：Run 必须在七日内；五分钟内一次最多评估 500 个 idle thread；每个 workspace 最多十个多轮评估器。
这些数值被官方标为可能变化，使用前应重新核对 S13。

#### Workspace evaluator SDK

管理 API 需要 Python `langsmith>=0.9.8` 或 npm `langsmith>=0.7.16`。
固定快照中的两个版本均满足要求。Python `Client.evaluators` 的生成资源是异步面，TS 方法返回 Promise。见 S11、S19。
两个 Client 都会先检查自托管后端至少为 `0.16.0`；版本更低时不会发送资源请求。见 S17、S18。

```python
created = await client.evaluators.create(
    name="Correctness evaluator",
    type="code",
    code_evaluator={
        "code": "def perform_eval(run, example):\n    return {'score': 1}",
        "language": "python",
    },
)
```

下表以 Python 的 snake_case 写参数；TS 使用同义 camelCase，`bulk_delete` 写作 `bulkDelete`。
传输层的额外 header、query、body 与 timeout 参数不改变 evaluator 业务契约。

| 资源方法 | 参数、默认值与返回 |
| --- | --- |
| `create(*, name=omit, type=omit, llm_evaluator=omit, code_evaluator=omit)` | `type` 为 `llm` 或 `code`，对应配置二选一；返回含 evaluator 的创建响应。生成客户端把字段写成可省略，服务端仍校验组合。 |
| `retrieve(evaluator_id)` | 返回单个 workspace evaluator。 |
| `update(evaluator_id, *, name=omit, llm_evaluator=omit, code_evaluator=omit)` | 部分更新名称、Judge 配置或代码配置；返回更新响应。不能改 `type`。 |
| `list(*, feedback_key=omit, name_contains=omit, resource_id=omit, tag_value_id=omit, type=omit, offset=omit, limit=omit, sort_by=omit, sort_by_desc=omit)` | 返回分页 evaluator；生成客户端未声明分页或排序默认值。 |
| `delete(evaluator_id, *, delete_run_rules: bool \| Omit = omit)` | 删除定义；参数为 true 时也删除引用它的 run rules。省略值的服务端布尔语义未公开。无业务返回。 |
| `bulk_delete(*, evaluator_ids, delete_run_rules: bool \| Omit = omit)` | 批量删除；可选参数语义相同。返回成功 ID 与逐项失败信息。 |
| `spend(*, period_start, dataset_id=omit, evaluator_id=omit, feedback_key=omit, group_by=omit, resource_id=omit, session_id=omit, type=omit)` | 查询从 `period_start` 起七日的每日 Judge 费用与 trace 数。`group_by` 可为 `evaluator`、`resource`、`run_rule`；它与 evaluator、project、dataset 四种选择必须恰有一种。 |

`code_evaluator` 只有 `code` 与 `language`，language 默认 `python`。
`llm_evaluator` 可含 `prompt_repo_handle`、`commit_hash_or_tag`、`playground_settings_id` 与 `variable_mapping`。

更新 Judge 时还可传 `num_few_shot_examples` 与 `use_corrections_dataset`。
这些方法管理可复用定义；项目 filter、sampling、thread idle time 与数据集绑定仍由相应附着流程配置。

Workspace 表只显示 Judge 与 Code。Composite 绑定具体项目或数据集，不出现在 workspace evaluator 表。见 S11。

### 5.7 Feedback、metric 配置与 trace 标注

#### Feedback 写入协议

```python
Client.create_feedback(
    run_id=None,
    key="unnamed",
    *,
    score=None,
    value=None,
    trace_id=None,
    correction=None,
    comment=None,
    source_info=None,
    feedback_source_type="api",
    source_run_id=None,
    feedback_id=None,
    feedback_config=None,
    stop_after_attempt=10,
    project_id=None,
    comparative_experiment_id=None,
    feedback_group_id=None,
    extra=None,
    error=None,
    session_id=None,
    start_time=None,
    extend_trace_retention=True,
) -> Feedback
```

必须提供 `run_id`、`trace_id` 或 `project_id` 中的一类目标。
Run/trace 目标与 Experiment 目标互斥；Experiment 汇总 feedback 使用 `project_id`。见 S14、S17。

| 字段组 | 语义 |
| --- | --- |
| `key`、`score`、`value`、`comment`、`correction` | 指标名、数值或布尔分数、展示值、解释、建议修正。 |
| `run_id`、`trace_id`、`project_id` | feedback 的目标。传 `trace_id` 可让 Python 在后台批量提交。 |
| `session_id`、`start_time` | Run 的所属项目与时间。新后端要求 Run feedback 提供 `session_id`。 |
| `feedback_source_type`、`source_info`、`source_run_id` | Python 接 `api` 或 `model`；TS 的 `feedbackSourceType` 另接 `app`。source Run 链接生成评价的 Judge trace。 |
| `comparative_experiment_id`、`feedback_group_id` | 把多个 Run 的偏好分数归入同一次比较。 |
| `feedback_config` | 说明连续、分类或自由文本协议。 |
| `feedback_id`、`extra`、`error` | 可选固定 UUID、feedback 元数据与布尔 `error` 字段。ID 省略时自动生成；源码没有进一步解释 `error`。 |
| `stop_after_attempt` | Python 请求最多尝试次数，默认 `10`。 |
| `extend_trace_retention` | 默认 `True`；设为 `False` 可避免这次 feedback 提升 trace 保留期。 |

TS 推荐对象参数：

```ts
await client.createFeedback({
  runId,
  sessionId,
  key,
  score,
  value,
  correction,
  comment,
  sourceInfo,
  feedbackSourceType,
  sourceRunId,
  feedbackId,
  feedbackConfig,
  comparativeExperimentId,
  startTime,
  extendTraceRetention,
});
```

TS 也允许用 `projectId` 替代 `runId`。旧的 `(runId, key, options)` 重载标为弃用。
两端的 create 都返回 `Feedback`；低分不会自动抛错或令 CI 失败。TS 的完整对象类型见 S18。

TS 还公开一个面向 evaluator 返回值的写入入口：

```ts
interface Client {
  logEvaluationFeedback(params: {
    evaluatorResponse: EvaluationResult | EvaluationResult[] | EvaluationResults;
    run: Run;
    projectId: string;
    sourceInfo?: Record<string, any>;
  }): Promise<EvaluationResult[]>;
}
```

`evaluatorResponse` 接受单个结果、结果数组或 `EvaluationResults`。
方法逐项写 `feedbackSourceType="model"` 的 feedback，并优先使用结果中的 `targetRunId`。
它返回归一化后的结果数组，不返回已创建的 `Feedback` 数组；任一写入失败会使 Promise 拒绝。
旧的四位置参数重载仍可调用，但标为弃用。见 S18。

#### Feedback CRUD 与浏览器提交

| Python | TypeScript | 返回与备注 |
| --- | --- | --- |
| `update_feedback(id, score=None, value=None, correction=None, comment=None)` | `updateFeedback(id, {score?, value?, correction?, comment?})` | 部分更新；无业务返回。传 `None` 不会把既有字段改成空值。 |
| `read_feedback(id)` | `readFeedback(id)` | 返回一个 `Feedback`。 |
| `list_feedback(*, run_ids=None, feedback_key=None, feedback_source_type=None, limit=None, **kwargs)` | `listFeedback({runIds, feedbackKeys, feedbackSourceTypes})` | Python 同步迭代，并把未声明 query 参数继续交给服务端；TS 异步迭代。 |
| `delete_feedback(id)` | `deleteFeedback(id)` | 删除一个 feedback；无业务返回。 |
| `create_presigned_feedback_token(run_id, feedback_key, expiration=None, feedback_config=None, feedback_id=None)` | `createPresignedFeedbackToken(runId, feedbackKey, {expiration?, feedbackConfig?})` | 生成只允许特定 Run 与 key 的提交 URL。默认三小时；Python 接 datetime 或 timedelta，TS 接 ISO 字符串或 `{days?, hours?, minutes?}`。只有 Python 可预设 feedback ID。 |
| `create_presigned_feedback_tokens(run_id, feedback_keys, expiration=None, feedback_configs=None)` | 无对应批量 convenience API | Python 一次生成多个 key 的 token；默认三小时，配置数必须与 key 数一致。 |
| `create_feedback_from_token(token_or_url, score=None, *, value=None, correction=None, comment=None, metadata=None)` | 浏览器向签名 URL 提交 | Python 返回 `None`；提交端不需要 API key。TS Client 没有同名方法。 |
| `list_presigned_feedback_tokens(run_id, limit=None)` | `listPresignedFeedbackTokens(runId)` | Python 可限制总数；TS 异步迭代且没有 limit 参数。 |

Feedback CRUD、token 与配置签名见 S17、S18。

#### Trace 行内标注

审阅者可在 trace 视图中选中根 Run 或任一中间 Run，再打开 `Annotate`。
侧栏可选择 workspace feedback tag、填写分数，也可单独写 comment。见 S21。

分类 tag 会把界面标签写入 `value`，把标签映射的数值写入 `score`。
连续 tag 接受配置范围内的浮点数。两者最终仍是本节的 Feedback，不是新的判定对象。见 S21。

SDK 的对应路径是给目标 Run 调用 `create_feedback` 或 `createFeedback`。
Python 可同时提供 `run_id` 与根 `trace_id`，从而给中间 Run 写评价并启用后台提交。
TS 传目标 `runId` 与其 `sessionId`。两端都不会因人工低分改变应用 Run 的错误状态。见 S14、S17、S18。

#### Feedback config

```python
client.create_feedback_config(
    feedback_key,
    *,
    feedback_config,
    is_lower_score_better=False,
)
```

| 类型 | 合法字段与校验 |
| --- | --- |
| `continuous` | 可选 `min`、`max`、`categories`；若同时给边界，必须 `min < max`，标签点要在范围内。 |
| `categorical` | 必传至少两个 `{value, label}`；值与标签各自唯一；不得传 `min`、`max`。 |
| `freeform` | 不得传 `min`、`max`、`categories`。 |

相同 key 与相同配置会返回既有对象；同 key 的冲突配置返回 HTTP 400。
`is_lower_score_better` 默认 `False`，只说明指标方向，不建立通过阈值。见 S15、S17、S18。

| Python | TypeScript | 返回 |
| --- | --- | --- |
| `create_feedback_config(feedback_key, *, feedback_config, is_lower_score_better=False)` | `createFeedbackConfig({feedbackKey, feedbackConfig, isLowerScoreBetter?})` | 创建或返回相同配置；TS 的方向默认值也是 `false`。 |
| `list_feedback_configs(*, feedback_key=None, name_contains=None, limit=None, offset=0)` | `listFeedbackConfigs({feedbackKeys?, nameContains?, limit?}={})` | Python 同步迭代；TS 异步迭代且没有 offset 参数。 |
| `update_feedback_config(key, *, feedback_config=None, is_lower_score_better=None)` | `updateFeedbackConfig(key, {feedbackConfig?, isLowerScoreBetter?}={})` | 部分更新并返回配置。 |
| `delete_feedback_config(key)` | `deleteFeedbackConfig(key)` | 软删除；以后可用相同 key 再创建。 |

Python 仍保留五个弃用签名：

- `list_feedback_formulas(*, dataset_id=None, session_id=None, limit=None, offset=0)`；
- `get_feedback_formula_by_id(feedback_formula_id)`；
- `create_feedback_formula(*, feedback_key, aggregation_type: "sum" | "avg", formula_parts, dataset_id=None, session_id=None)`；
- `update_feedback_formula(feedback_formula_id, *, feedback_key, aggregation_type: "sum" | "avg", formula_parts)`；
- `delete_feedback_formula(feedback_formula_id)`。

五个方法都会立即抛 `NotImplementedError`，没有可用返回。组合 feedback 只能在 UI 中配置。见 S17。

#### 人工标注队列

单 Run 队列展示一个 Run 与 rubric。成对队列展示 A、B 与 Equal，并在后台给两个 Run 写一组二元 feedback。
两者都支持 reviewer 数量、指定 reviewer、保留时长、评语、重新排队与完成状态。见 S15。

| Python convenience API | TS convenience API | 作用与返回 |
| --- | --- | --- |
| `create_annotation_queue(*, name, description=None, queue_id=None, rubric_instructions=None, rubric_items=None)` | `createAnnotationQueue({name, description?, queueId?, rubricInstructions?, rubricItems?})` | 创建队列并返回详情。 |
| `list_annotation_queues(*, queue_ids=None, name=None, name_contains=None, limit=None)` | `listAnnotationQueues({queueIds?, name?, nameContains?, limit?}={})` | Python 同步迭代；TS 异步迭代。 |
| `read_annotation_queue(queue_id)` | `readAnnotationQueue(queueId)` | 返回队列详情。 |
| `update_annotation_queue(queue_id, *, name=None, description=None, rubric_instructions=None, rubric_items=None)` | `updateAnnotationQueue(queueId, {name?, description?, rubricInstructions?, rubricItems?})` | 部分更新；`rubric_items` 会整组替换。返回 `None` / Promise<void>。 |
| `delete_annotation_queue(queue_id)` | `deleteAnnotationQueue(queueId)` | 删除队列；返回 `None` / Promise<void>。 |
| `add_runs_to_annotation_queue(queue_id, *, runs=None, run_ids=None)` | `addRunsToAnnotationQueue(queueId, runs: RunKey[] \| string[])` | 两种输入只能选一类。RunKey 形状是推荐面；纯 ID 形状将在 2027-01-31 后移除。返回 `None` / Promise<void>。 |
| `list_runs_from_annotation_queue(queue_id, *, status=None, limit=None)` | `listRunsFromAnnotationQueue(queueId, {status?, limit?}={})` | 同步或异步迭代需要本人、需要他人或已完成的 Run。 |
| `get_run_from_annotation_queue(queue_id, *, index)` | `getRunFromAnnotationQueue(queueId, index)` | 按队列位置取 Run 并返回队列信息。 |
| `delete_run_from_annotation_queue(queue_id, *, run_id)` | `deleteRunFromAnnotationQueue(queueId, queueRunId)` | 从队列移除 Run；返回 `None` / Promise<void>。 |
| 无对应 Python convenience API | `getSizeFromAnnotationQueue(queueId)` | 返回 `{size: number}`。 |

Python `RunKey` 的字段是 `run_id`、`session_id`、`start_time` 与可选 `source_proposed_example_id`；TS 使用同义 camelCase。
旧列表的 status 全部值是 `needs_my_review`、`needs_others_review` 与 `completed`；省略时不按状态筛选。

convenience API 的 `rubric_items` 完整字段是 `feedback_key`、`description`、`score_descriptions`、`value_descriptions`、`is_required`。
`is_required` 默认 `False`；feedback key 必须先有组织级 config。见 S15。

0.10.17/0.8.9 还公开生成式 `client.annotation_queues` 资源。
它的 `items` 子资源同时支持 Run 与 thread，避免依赖旧的 Run 位置 API。
Client 同样要求自托管后端至少为 `0.16.0`。见 S17、S18。

生成资源的 rubric item 比 convenience 类型多一个可选 `is_assertion` 字段。
Assertions 功能页仍写明 UI-only，也没有说明这个字段的请求效果；本文只列出类型可见性，不把它当作受支持创建面。见 S15、S19。

下表列业务方法，不列 raw response 与 streaming response 的传输包装。
方法名采用 Python snake_case；TS 使用同义 camelCase。`=omit` 表示不发送字段，不代表 false 或 `None`。见 S19。

Python `Client.annotation_queues` 返回异步资源，因此单项方法要 `await`，列表方法返回异步 paginator。
TS 单项方法返回 Promise，列表方法返回 PagePromise。生成资源没有为省略字段公布服务端默认值。

队列资源的完整业务面如下：

| 方法签名 | 返回与作用 |
| --- | --- |
| `retrieve(queue_id)` | 返回 `AnnotationQueueRetrieveResponse`。 |
| `update(queue_id, *, default_dataset=omit, description=omit, enable_reservations=omit, metadata=omit, name=omit, num_reviewers_per_item=omit, reservation_minutes=omit, reviewer_access_mode=omit, rubric_instructions=omit, rubric_items=omit)` | 部分更新；返回字段未细化的 object。`reviewer_access_mode` 可为 `any` 或 `assigned`。 |
| `delete(queue_id)` | 删除队列；返回字段未细化的 object。 |
| `annotation_queues(*, name, id=omit, created_at=omit, default_dataset=omit, description=omit, enable_reservations=omit, metadata=omit, num_reviewers_per_item=omit, reservation_minutes=omit, reviewer_access_mode=omit, rubric_instructions=omit, rubric_items=omit, session_ids=omit, updated_at=omit)` | 创建队列并返回 `AnnotationQueueSchema`。这个重复名来自生成的 OpenAPI operation。 |
| `create_run_status(annotation_queue_run_id, *, override_added_at=omit, status=omit)` | 写旧 Run 队列项状态；返回字段未细化的 object。 |
| `export(queue_id, *, end_time=omit, include_annotator_detail=omit, start_time=omit)` | 导出指定时间段；返回字段未细化的 object。 |
| `populate(*, queue_id, session_ids, extend_trace_retention=omit)` | 从项目填充队列；返回字段未细化的 object。 |
| `retrieve_annotation_queues(*, assigned_to_me=omit, dataset_id=omit, ids=omit, limit=omit, name=omit, name_contains=omit, offset=omit, queue_type=omit, sort_by=omit, sort_by_desc=omit, tag_value_id=omit)` | 分页列队列；`queue_type` 可为 `single` 或 `pairwise`。 |
| `retrieve_queues(run_id)` | 返回该 Run 所在队列的响应。 |
| `retrieve_run(index, *, queue_id, include_extra=omit)` | 按位置返回带队列信息的 Run；此面属于旧 Run 路径。 |
| `retrieve_size(queue_id, *, status=omit)` | 返回 `AnnotationQueueSizeSchema`；status 可为 `needs_my_review`、`needs_others_review` 或 `completed`。 |
| `retrieve_total_archived(queue_id, *, end_time=omit, start_time=omit)` | 返回指定时间段的 archived 数量。 |
| `retrieve_total_size(queue_id)` | 返回队列总数。 |

`items` 是 Run 与 thread 共用的新面：

| 方法签名 | 返回与作用 |
| --- | --- |
| `items.create(queue_id, *, extend_trace_retention=omit, items=omit)` | 每项可含 `item_type`、`project_id`、`run_id`、`session_id`、`start_time`、`thread_id`、`source_proposed_example_id`；item type 为 `RUN` 或 `THREAD`。返回 `ItemCreateResponse`。 |
| `items.update(item_id, *, queue_id, added_at=omit, last_reviewed_time=omit)` | 更新队列时间字段；返回 `ItemUpdateResponse`。 |
| `items.list(queue_id, *, status, cursor=omit, direction=omit, item_type=omit, page_size=omit)` | cursor 分页；status 为 `needs_my_review`、`needs_others_review` 或 `archived`。direction 为 `forward` 或 `backward`，item type 为 `RUN` 或 `THREAD`，page size 最大 100。 |
| `items.create_status(queue_item_id, *, override_added_at=omit, status=omit)` | status 可为 `viewed` 或 `completed`；返回 `ItemCreateStatusResponse`。 |
| `items.delete_all(queue_id, *, item_ids=omit)` | 删除指定 items；返回 `ItemDeleteAllResponse`。 |
| `items.retrieve_count(queue_id, *, status, end_time=omit, start_time=omit)` | status 接受 `all`、`needs_my_review`、`needs_others_review` 或 `archived`；返回计数响应。 |
| `items.retrieve_placement(item_id, *, queue_id)` | 返回 item 在队列中的位置。 |

`runs` 子资源的六个方法全部弃用，并注明 2027-01-31 后移除：

| 方法签名 | 返回与替代 |
| --- | --- |
| `runs.create(queue_id, *, body, extend_trace_retention=omit)` | body 接受 Run ID 数组、`{run_id, source_proposed_example_id?}` 数组，或旧 `{run_id, parent_run_id?, session_id?, start_time?, trace_id?, trace_tier?}` 数组。返回 `RunCreateResponse`；改用 `items.create`。 |
| `runs.update(queue_run_id, *, queue_id, added_at=omit, last_reviewed_time=omit)` | 返回字段未细化的 object。改用 `items.update`。 |
| `runs.list(queue_id, *, archived=omit, include_stats=omit, limit=omit, offset=omit, status=omit)` | 返回 `RunListResponse`；status 可为 `needs_my_review`、`needs_others_review` 或 `completed`。改用 `items.list`。 |
| `runs.create_by_key(queue_id, *, body, extend_trace_retention=omit)` | 每项必传 Run、session 与 start time，可传建议 Example ID；返回 `RunCreateByKeyResponse`。改用 `items.create`。 |
| `runs.delete_all(queue_id, *, delete_all=omit, exclude_run_ids=omit, run_ids=omit)` | 返回字段未细化的 object。改用 `items.delete_all`。 |
| `runs.delete_queue(queue_run_id, *, queue_id)` | 删除单个旧 Run 队列项，返回字段未细化的 object。改用 `items.delete_all`。 |

这些方法管理队列，不产生 score，也没有 skip 或无分返回。
空 ID 会先触发客户端 `ValueError`；服务端拒绝则抛 SDK HTTP 异常，不会改写成 feedback。

#### Assertions

Assertions 只在单 Run 标注队列的 UI 中创建。每项只有自由 key 与一句 comment；`must_` 和 `must_not_` 只是命名习惯。

```json
{
  "assertions": [
    {
      "key": "must_cite_source",
      "comment": "The response cites the source URL it is drawing from."
    }
  ]
}
```

保存时，上述对象成为 Example 的 `outputs`，实际 Run 输出不会成为该 Example 的参考输出。
评估器需读取 `reference_outputs["assertions"]`，再为每项返回一个同 key feedback。见 S15。

Assertions 没有 thread 面或成对队列面，也没有官方说明的 SDK 创建流程。
生成队列资源泄漏的 `is_assertion` 字段不改变这条受支持边界。
也没有内建的 prompt、模型、阈值、失败动作或全项聚合；这些都由后续离线评估器决定。

### 5.8 pytest、Vitest 与 Jest

测试框架接入同时产生两种结果：框架断言控制本地进程，LangSmith 把测试状态写成布尔 `pass` feedback。
额外的评价可以只写 feedback，也可以再接原生断言决定 CI 状态。见 S16。

#### pytest plugin

```bash
python -m pip install "langsmith[pytest]==0.10.17"
```

plugin 的最低版本要求是 `langsmith>=0.3.4`。每个带 `@pytest.mark.langsmith` 的 case 对应一个 Example。
默认每个测试文件对应一个数据集，每次 pytest 调用创建一个实验。

```python
import pytest
from langsmith import testing as ls


@pytest.mark.langsmith(output_keys=["expected"])
def test_uppercase(text: str = "hello", expected: str = "HELLO") -> None:
    actual = text.upper()
    ls.log_outputs({"actual": actual})
    ls.log_feedback(key="exact", score=actual == expected)
    assert actual == expected
```

marker 接受与旧装饰器相同的配置：`id`、`output_keys`、`client`、`test_suite_name`、`metadata`、
`experiment_metadata`、`repetitions`、`split`、`cached_hosts`。这些选项均默认 `None`。
未传 `output_keys` 的 fixture 或参数会成为 inputs。

| Python 测试 API | 签名与行为 |
| --- | --- |
| `testing.log_inputs(inputs)` | 写 Example inputs；同一 case 再调用会替换先前值。 |
| `testing.log_outputs(outputs)` | 写 Run outputs；同一 case 再调用会替换先前值。 |
| `testing.log_reference_outputs(outputs)` | 写 Example 参考输出；同一 case 再调用会替换先前值。 |
| `testing.log_feedback(feedback=None, /, *, key: str, score=None, value=None, **create_feedback_args)` | 可用形状是 key 加 score 或 value；额外参数交给 `create_feedback`。固定签名要求 key。 |
| `testing.trace_feedback(*, name="Feedback")` | 把 Judge 计算放进独立 Run，并把其 ID 作为 feedback 的 `source_run_id`。 |
| `@langsmith.test` 或 `@langsmith.test(id=None, output_keys=None, client=None, test_suite_name=None, metadata=None, experiment_metadata=None, repetitions=None, split=None, cached_hosts=None)` | 旧装饰器；可直接装饰函数，也可传完整配置。 |
| `@langsmith.unit` 或 `@langsmith.unit(id=None, output_keys=None, client=None, test_suite_name=None, metadata=None, experiment_metadata=None, repetitions=None, split=None, cached_hosts=None)` | `test` 的旧别名。官方 pytest 页面把两者归入 Legacy。 |

`repetitions` 会把同一 case 执行多次。pytest 的通过或失败仍由每次函数执行和断言决定。
`log_feedback` 只上传评价，不会自行失败。

`log_feedback` 的实现还保留位置参数字典或字典列表分支，但固定签名同时要求 `key`，并禁止两种输入并用。
因此 0.10.17 不能通过普通 Python 调用到该分支；本文不把它列为可用重载。见 S16。

`langsmith.expect` 是会同时写 feedback 的断言工具：

| 构造入口 | 默认值与返回 |
| --- | --- |
| `expect(value)` 或 `expect.value(value)` | 返回 matcher，不先写指标。 |
| `expect.score(score, key="score", source_run_id=None, comment=None)` | 先写数值或布尔 feedback，再返回 matcher。 |
| `expect.embedding_distance(prediction, reference, config=None)` | 默认 OpenAI encoder 与 cosine；也支持 euclidean、manhattan、chebyshev、hamming。先写距离。 |
| `expect.edit_distance(prediction, reference, config=None)` | metric 默认 `damerau_levenshtein`，`normalize_score=True`；另支持 levenshtein、jaro、jaro_winkler、hamming、indel。 |

matcher 的完整同步方法如下，全部返回 `None`：

| 方法 | 判定与默认值 |
| --- | --- |
| `to_be_less_than(value)` | 当前值严格小于 `value`。 |
| `to_be_greater_than(value)` | 当前值严格大于 `value`。 |
| `to_be_between(min_value, max_value)` | 使用两端都不包含的开区间。 |
| `to_be_approximately(value, precision=2)` | `round(current_value, precision) == round(value, precision)`。 |
| `to_equal(value)` | 使用 Python 相等比较。 |
| `to_be_none()` | 当前值是 `None`。 |
| `to_contain(value)` | `value in current_value` 成立。 |
| `against(func, /)` | `func(current_value)` 返回真值。 |

matcher 成功或失败都会写 key 为 `expectation` 的二元 feedback；失败时还会抛 `AssertionError`。
只计算距离而不调用 matcher 时，不产生断言失败。

pytest 插件还支持以下执行面：

- `LANGSMITH_TEST_CACHE=<path>` 把 HTTP 响应写到磁盘；`cached_hosts` 在 0.4.10 起限制要缓存的 host；
- pytest-xdist、pytest-asyncio、parametrize 与 pytest-watch 按框架原方式使用；
- `pytest --langsmith-output` 显示实时结果表，但不能与 xdist 共用；
- `LANGSMITH_TEST_TRACKING=false` 只在本地执行，不同步数据集与实验。

#### Vitest 与 Jest

最低 SDK 版本是 `langsmith>=0.3.1`。分别从 `langsmith/vitest` 与 `langsmith/jest` 导入。
官方建议为 eval 使用独立配置和 reporter；JSDom 模式不受支持。见 S16。

```ts
import * as ls from "langsmith/vitest";

ls.describe("uppercase", () => {
  ls.test(
    "uppercases text",
    {
      inputs: { text: "hello" },
      referenceOutputs: { text: "HELLO" },
    },
    async ({ inputs, referenceOutputs }) => {
      const outputs = { text: inputs.text.toUpperCase() };
      ls.logOutputs(outputs);
      ls.logFeedback({
        key: "exact",
        score: outputs.text === referenceOutputs?.text,
      });
      ls.expect(outputs.text).toBe(referenceOutputs?.text);
    },
  );
});
```

| JS/TS 测试 API | 签名与行为 |
| --- | --- |
| `test`、`it` | `(name, {id?, inputs, referenceOutputs?, config?, split?, metadata?}, callback, timeout?)`。回调可返回 outputs。 |
| `test.each`、`test.only.each`、`test.skip.each` | `(table, config?)(name, callback, timeout?)`。每项必传 inputs，可传 ID、参考输出与回调附加字段。 |
| `test.concurrent`、`test.concurrent.only`、`test.concurrent.skip` | 与基础 test 同签名，改变并发、聚焦或跳过行为。三者各有同形 `.each`。 |
| `test.skip`、`test.only` | 与基础 test 同签名，沿用框架跳过与聚焦语义。跳过的回调不执行。 |
| `describe`、`describe.only`、`describe.skip`、`describe.concurrent` | `(name, fn, {client?, enableTestTracking?, testSuiteName?, projectName?, description?, metadata?, upsert?, projectExtra?, numExamples?, numRepetitions?, evaluatorKeys?}?)`；一个 block 对应一个数据集。 |
| `logOutputs(outputs)` | 写当前 Run 输出。失败前没有调用或返回时，实验行没有最终输出。 |
| `logFeedback({key, score, comment?}, {sourceRunId?}?)` | 写评价，不触发测试失败。 |
| `wrapEvaluator(evaluator)` | evaluator 可返回一个 `{key, score, comment?}` 或其数组。返回的异步函数签名是 `(input, (Partial<RunTreeConfig> & {runId?: string})?)`；它返回原结果，并为每项自动写 feedback。 |
| `expect(output).evaluatedBy(evaluator)` | 自动传当前 inputs、参考输出与 output，写分数，再接框架 matcher。 |
| `wrapVitest`、`wrapJest` | 把自定义 Jest-like 方法集包装为 LangSmith 测试面。 |
| 默认导出的 `LangSmithEvalReporter` | 分别从 `langsmith/vitest/reporter` 与 `langsmith/jest/reporter` 配置；打印 inputs、参考输出、outputs、状态、feedback 与实验链接。配置数组中要另行保留框架 reporter。 |

case 的 `config` 可含 `repetitions`、`enableTestTracking` 与 RunTree 配置。
回调还收到 `testMetadata`。
其完整字段是 `exampleId?`、`experimentId?`、`datasetId?`、`testTrackingEnabled`、`repetition` 与 `split?`。

两端附加三种字符串 matcher：

| Matcher | 默认值与判定 |
| --- | --- |
| `toBeRelativeCloseTo(expected, options?)` | Levenshtein 相对距离，`threshold=0.1`；距离小于或等于阈值时通过。 |
| `toBeAbsoluteCloseTo(expected, options?)` | Levenshtein 绝对距离，`threshold=3`；距离小于或等于阈值时通过。 |
| `toBeSemanticCloseTo(expected, options)` | 必传 embeddings；`threshold=0.2`，`algorithm="cosine"`；也支持 `dot-product`。similarity 大于或等于 `1 - threshold` 时通过。 |

相对距离的 threshold 必须在 0 到 1 内，否则 matcher 抛错。
不支持的 algorithm 也会抛错；这些错误不会写成无分 feedback。

`LANGSMITH_TEST_TRACKING=false` 会保留本地测试，只停止同步。
Vitest 与 Jest 支持 `.skip`，但官方页没有定义远端如何表示被跳过的 case；本文不把它等同于无分 feedback。

## 6. 可直接复制的完整场景

以下脚本都要求先设置 `LANGSMITH_API_KEY`。脚本会在账户中创建唯一数据集与实验。
场景二会产生一次付费 Judge 调用；其余三个场景没有模型费用。

### 场景一：确定性逐行检查、repetitions 与汇总分数

安装：

```bash
python -m pip install "langsmith==0.10.17"
```

保存为 `deterministic_and_summary.py`：

```python
from uuid import uuid4

from langsmith import Client


client = Client()
dataset_name = f"deterministic-summary-{uuid4().hex[:8]}"
dataset = client.create_dataset(dataset_name)
client.create_examples(
    dataset_id=dataset.id,
    examples=[
        {"inputs": {"n": 2}, "outputs": {"square": 4}},
        {"inputs": {"n": 3}, "outputs": {"square": 9}},
        {"inputs": {"n": 5}, "outputs": {"square": 25}},
    ],
)


def target(inputs: dict) -> dict:
    return {"square": inputs["n"] ** 2}


def exact_square(outputs: dict, reference_outputs: dict) -> dict:
    passed = outputs["square"] == reference_outputs["square"]
    return {"key": "exact_square", "score": passed}


def valid_type(outputs: dict) -> dict:
    return {
        "key": "integer_output",
        "score": isinstance(outputs.get("square"), int),
    }


def pass_rate(outputs: list[dict], reference_outputs: list[dict]) -> dict:
    matches = [
        actual["square"] == expected["square"]
        for actual, expected in zip(outputs, reference_outputs, strict=True)
    ]
    return {"key": "pass_rate", "score": sum(matches) / len(matches)}


results = client.evaluate(
    target,
    data=dataset_name,
    evaluators=[exact_square, valid_type],
    summary_evaluators=[pass_rate],
    num_repetitions=2,
    max_concurrency=2,
    experiment_prefix="deterministic-summary",
)

assert len(results) == 6
print(results.experiment_name)
print(results.url)
```

三个 Example 各执行两次，因此有六个结果行。
两个逐行指标各写六份 feedback，`pass_rate` 写一份 Experiment 级 feedback。形状依据 S4、S8。

### 场景二：开放式 LLM-as-Judge

安装并设置 Judge key：

```bash
python -m pip install "langsmith==0.10.17" "openevals==0.2.0"
export OPENAI_API_KEY="your-openai-key"
export JUDGE_MODEL="openai:gpt-5.4"
```

保存为 `open_judge.py`：

```python
import os
from uuid import uuid4

from langsmith import Client
from openevals.llm import create_llm_as_judge
from openevals.prompts import CORRECTNESS_PROMPT


client = Client()
dataset_name = f"open-judge-{uuid4().hex[:8]}"
dataset = client.create_dataset(dataset_name)
client.create_examples(
    dataset_id=dataset.id,
    examples=[
        {
            "inputs": {"question": "What is the capital of France?"},
            "outputs": {"answer": "Paris"},
        }
    ],
)


def target(inputs: dict) -> dict:
    return {"answer": "The capital is Paris."}


correctness = create_llm_as_judge(
    prompt=CORRECTNESS_PROMPT,
    model=os.environ["JUDGE_MODEL"],
    feedback_key="correctness",
    continuous=False,
    use_reasoning=True,
)

results = client.evaluate(
    target,
    data=dataset_name,
    evaluators=[correctness],
    experiment_prefix="open-judge",
    max_concurrency=1,
)

for row in results:
    print(row["evaluation_results"])
print(results.url)
```

`CORRECTNESS_PROMPT` 是 OpenEvals 0.2.0 的官方常量。
Judge 返回布尔 `correctness` 与解释；模型请求失败时评估器抛错，由 LangSmith runner 的逐行错误路径处理。见 S10。

### 场景三：两个既有实验的成对比较

安装：

```bash
python -m pip install "langsmith==0.10.17"
```

保存为 `pairwise.py`：

```python
from uuid import uuid4

from langsmith import Client


client = Client()
dataset_name = f"pairwise-{uuid4().hex[:8]}"
dataset = client.create_dataset(dataset_name)
client.create_examples(
    dataset_id=dataset.id,
    examples=[
        {
            "inputs": {"question": "What is 2 + 2?"},
            "outputs": {"answer": "4"},
        }
    ],
)


def concise_target(inputs: dict) -> dict:
    return {"answer": "4"}


def verbose_target(inputs: dict) -> dict:
    return {"answer": "After thinking carefully, the answer is 4."}


concise = client.evaluate(
    concise_target,
    data=dataset_name,
    experiment_prefix="concise",
)
verbose = client.evaluate(
    verbose_target,
    data=dataset_name,
    experiment_prefix="verbose",
)


def ranked_reference_match(
    outputs: list[dict], reference_outputs: dict
) -> list[int]:
    matches = [output["answer"] == reference_outputs["answer"] for output in outputs]
    if matches == [True, False]:
        return [1, 0]
    if matches == [False, True]:
        return [0, 1]
    return [0, 0]


comparison = client.evaluate(
    (concise.experiment_name, verbose.experiment_name),
    evaluators=[ranked_reference_match],
    randomize_order=True,
    max_concurrency=4,
)

print(comparison.url)
```

Python 比较评估器允许按 Run 顺序返回分数列表；函数名成为 feedback key。
打乱顺序后，runner 仍把每个列表位置对应到传入该回调的 Run。见 S8。

### 场景四：确定性 agent trajectory 检查

安装：

```bash
python -m pip install "langsmith==0.10.17" "openevals==0.2.0"
```

保存为 `trajectory.py`：

```python
from uuid import uuid4

from langsmith import Client
from openevals.trajectory import create_trajectory_match_evaluator


def expected_messages() -> list[dict]:
    return [
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": "call_weather",
                    "type": "function",
                    "function": {
                        "name": "weather",
                        "arguments": '{"city":"Taipei"}',
                    },
                }
            ],
        },
        {
            "role": "tool",
            "tool_call_id": "call_weather",
            "content": "sunny",
        },
        {"role": "assistant", "content": "It is sunny in Taipei."},
    ]


client = Client()
dataset_name = f"trajectory-{uuid4().hex[:8]}"
dataset = client.create_dataset(dataset_name)
client.create_examples(
    dataset_id=dataset.id,
    examples=[
        {
            "inputs": {"question": "How is the weather in Taipei?"},
            "outputs": {"messages": expected_messages()},
        }
    ],
)


def target(inputs: dict) -> dict:
    return {"messages": expected_messages()}


trajectory_match = create_trajectory_match_evaluator(
    trajectory_match_mode="strict",
    tool_args_match_mode="exact",
)

results = client.evaluate(
    target,
    data=dataset_name,
    evaluators=[trajectory_match],
    experiment_prefix="trajectory-strict",
)

for row in results:
    print(row["evaluation_results"])
print(results.url)
```

这个匹配器验证 role 顺序、工具选择与工具参数，返回 `trajectory_strict_match`。
它不检查普通消息内容，因此还要单独评价最终回答。
要比较无序、子集或超集的工具调用集合，可改用 catalog 中列出的其他模式。见 S10。

## 7. 结果、诊断、artifact、CI 与再评分

### 结果与诊断面

离线实验的主要 artifact 是服务端 Experiment、Run、Example 与 Feedback 图。
Python `ExperimentResults` 和 TS 结果对象是执行期视图，不是自包含的磁盘文件。见 S1、S4、S6。

| 面 | 能看到什么 | 诊断用途 |
| --- | --- | --- |
| Dataset & Experiments 表 | inputs、参考输出、目标 outputs、每个 feedback key、耗时、错误与实验比较 | 找到退化的 Example 或指标。 |
| 单行 trace | 根 Run、子 Run、inputs、outputs、error、metadata、附件 | 确定错误发生在应用的哪一步。 |
| Feedback 详情 | score、value、comment、correction、config 与评价主体 | 区分布尔结果、连续分数和人工说明。 |
| Evaluator trace | Judge prompt、模型调用与返回；由 `source_run_id` 链接 | 调查 Judge 为什么给出该分数。 |
| Online evaluator Logs | 触发规则、执行状态、backfill 进度与错误 | 调查 filter、sampling 或托管代码失败。 |
| Annotation queue | rubric、reviewer 状态、评语、修正 Example、A/B/Equal | 调查人工分歧并形成数据集。 |

Python 可用 `to_pandas()` 得到内存 DataFrame，也可逐行迭代保留应用所需字段。
这两个动作不会自动生成带完整 trace、prompt 与依赖信息的可移植 artifact。

`upload_results=False` 是 Python 的 beta 本地执行选项，只适用于新实验。
它不建立稳定文件格式；若需要长期保存，作者仍要自行序列化所需结果。

在线评估与直接 `create_feedback` 默认可能提升 trace 保留期。
项目可对在线评估器关闭提升，直接写 feedback 可用 `extend_trace_retention=False`。见 S11、S14。

### repetitions 的读数

`num_repetitions=R` 保留每次独立 Run 与 feedback。
UI 会显示各次分数、平均值与标准差，便于观察非确定性；它不会自动把均值变成 CI 通过条件。见 S8。

要避免把重复次数误当样例数，汇总函数应同时检查 Example ID、Run 数与实际 feedback 数。
低样本标准差只是描述性读数，不提供统计显著性保证。

### CI

`evaluate()` 在分数低时仍会正常返回。它是实验执行器，不是失败协议。
CI 有两条可靠路径：

1. 用 pytest、Vitest 或 Jest 的断言决定退出码，同时把 `pass` 与额外 feedback 同步到 LangSmith；
2. 用 `evaluate()` 后读取所有结果，显式检查缺失 feedback、错误 Run、样例数和阈值，再由调用脚本退出非零。

第二条路径不能只计算平均分。若某个 evaluator 抛错后被省略，均值可能只来自成功的子集。
调用方应先验证每个预期 key 的数量，再比较阈值。失败语义见 S4 至 S7。

付费 Judge 的 CI 可用 pytest `LANGSMITH_TEST_CACHE` 减少重复 HTTP 调用。
`LANGSMITH_TEST_TRACKING=false` 适合验证本地断言路径，但不会证明服务端同步与展示。见 S16。

### 既有实验再评分

Python 可把实验名或 ID 作为 `target`：

```python
results = client.evaluate(
    "existing-experiment-name",
    evaluators=[new_row_evaluator],
    summary_evaluators=[new_summary_evaluator],
    max_concurrency=4,
)
```

runner 读取既有 Run 与关联 Example，只执行新评估器，不再次调用应用。
这适合更改 rubric、Judge 或汇总算法后重算；它不能补回原 Run 中从未写出的字段。见 S9。

比较入口同样复用既有实验。在线 rule 的 backfill 只能在创建 rule 时选择日期。
绑定到数据集的 evaluator 只影响绑定后创建的实验，不追补旧实验。见 S12、S13。

## 8. 自定义扩展

### 选择最低层级

| 需求 | 推荐扩展点 |
| --- | --- |
| 单 Example 的业务规则 | Python/TS 逐行函数，优先只声明需要的参数名。 |
| 同时返回多个维度 | 返回结果数组或 `EvaluationResults`。 |
| 全数据集 precision、recall、F1、分布或费用 | `summary_evaluators` / `summaryEvaluators`。 |
| 版本偏好 | comparative evaluator，返回按 Run ID 的分数字典。 |
| 通用 Judge 或结构比较 | OpenEvals 工厂，再作为 LangSmith evaluator 传入。 |
| 生产 trace 规则 | 在线 Code 或 Judge；用 filter 与 sampling 控制触发面。 |
| 人工 rubric | feedback config + annotation queue rubric item。 |
| 测试退出码 | pytest、Vitest 或 Jest 原生断言。 |

### 自定义函数工厂

把配置放在闭包中，可以复用 evaluator 并保持返回 key 稳定：

```python
def create_required_keys_evaluator(*required_keys: str):
    def required_keys(outputs: dict) -> list[dict]:
        return [
            {
                "key": f"has_{key}",
                "score": key in outputs,
                "comment": f"Required output key: {key}",
            }
            for key in required_keys
        ]

    return required_keys
```

这类工厂不需要继承 SDK 类。只有需要动态选择目标子 Run、共用复杂状态或直接调用 `evaluate_run` 时，才需要 `RunEvaluator`。

### Assertions 适配器

UI Assertions 只是参考数据。可用一个 dispatcher 把稳定 key 交给确定性函数，并让未知 key 明确成为无分结果：

```python
def grade_against_assertions(
    outputs: dict,
    reference_outputs: dict,
) -> list[dict]:
    checks = {
        "must_cite_source": lambda out: "http" in out.get("answer", ""),
        "must_not_invent_url": lambda out: "invented.example" not in out.get(
            "answer", ""
        ),
    }
    results = []
    for assertion in reference_outputs["assertions"]:
        check = checks.get(assertion["key"])
        if check is None:
            results.append(
                {
                    "key": assertion["key"],
                    "score": None,
                    "comment": "No deterministic check is configured",
                }
            )
        else:
            results.append(
                {
                    "key": assertion["key"],
                    "score": check(outputs),
                    "comment": assertion["comment"],
                }
            )
    return results
```

开放要求可在同一循环调用 Judge。作者应保留 `source_run_id`，并把未知 key 与 Judge 错误同普通失败区分。

### 指标协议与人工 rubric

先创建 feedback config，再在队列的 `rubric_items` 引用同 key，可以统一人工输入的量纲。
连续量要声明范围；分类量要声明所有标签；自由文本不参与数值聚合。见 S15。

队列级 `description`、`score_descriptions` 与 `value_descriptions` 可以针对一次审阅任务细化说明。
组织级 config 保持 key 与量纲，队列级 rubric 保持情境说明。

## 9. 好在哪里

以下是研究判断。

1. 参数名注入很省代码。只写 `outputs, reference_outputs` 就能得到常用数据，不必接触 Run 与 Example 类。
2. 返回协议允许从布尔值逐步升级到多指标、解释、修正和 feedback config，简单规则的起步成本低。
3. 逐行、汇总、比较与重复执行共享 Experiment/Feedback 模型，UI 能在同一数据集视图比较版本。
4. `randomize_order` 是具体且可操作的成对 Judge 防偏差选项，不要求每位作者重写打乱逻辑。
5. OpenEvals 把 prompt、确定性匹配、轨迹与代码检查做成普通函数，可直接传给 LangSmith runner。
6. pytest、Vitest 与 Jest 同时保留本地退出码和服务端实验，适合从传统测试逐步进入 eval 工作流。
7. `source_run_id` 与 `trace_feedback` 把“谁给的分”连回 Judge trace，诊断不只剩一个数字。
8. 既有实验再评分避免重复调用应用；repetitions 又保留每次 Run，并在 UI 提供均值和标准差。
9. 人工队列、修正 Example 与 Assertions 形成生产 trace 到离线数据集的短路径。
10. 在线 filter、sampling、费用上限与保留期开关把 Judge 成本和数据保存副作用放到配置面。

## 10. 不好的地方与不应类比 NiceEval 的边界

以下先列官方可见事实，再给研究判断。

### 作者面被拆成多套系统

离线 SDK、OpenEvals、在线 UI、测试框架与人工标注各有自己的函数形状和生命周期。
Composite 主要在 UI，Summary 只在离线 SDK，Assertions 只在标注 UI。见 S2、S11、S15、S16。

这使“写一个评价并在所有位置复用”并不成立。
离线函数不能直接部署成在线代码；在线 Code 也不能导入任意依赖或访问网络。

### Python 与 TypeScript 不对称

| 差异 | Python | TypeScript |
| --- | --- | --- |
| 简写返回 | 支持布尔、数值、字符串和省略 key 的字典 | 公开类型要求 `EvaluationResult` 或其数组 |
| 异步汇总 | 不支持 | 支持 |
| 后台/流式 | `blocking=False` 与 `wait()` | Promise 完成后才返回全部结果 |
| 既有单实验再评分 | 文档与 API 都支持 | 没有对应单实验入口 |
| 比较入口 | 独立 `evaluate_comparative` 仍在；`aevaluate` 不支持 | `evaluateComparative` 已弃用，改用 `evaluate([experimentA, experimentB], options)` |
| 字段命名 | `reference_outputs`、`source_run_id` | LangSmith 与 OpenEvals 具体工厂用 camelCase；OpenEvals 的 `SimpleEvaluator` 类型例外地声明 `reference_outputs` |

同一团队跨语言时，不能只翻译标识符。错误处理、返回简写、结果对象和异步模型都要重新确认。见 S4 至 S10。

固定 TS 源码中的 `createComparativeExperiment` 还写了 `if (!referenceDatasetId == null)`。
`!referenceDatasetId` 总是布尔量，布尔量与 `null` 的宽松相等比较总为假，因此这个本地检查不会抛错。
Python 在同一位置会拒绝缺少参考数据集的请求。见 S17、S18。

### 弃用与生成 API 增加认知成本

Python 的 `langsmith.evaluation` 导入面、`StringEvaluator`、`LLMEvaluator` 与单 Run evaluate 方法带弃用标记。
TS 的 `evaluateComparative` 弃用，但 TS `StringEvaluator` 的固定源码没有同样标记。

Python 同步 `Client` 上的 `evaluators` 属性返回异步生成资源，需要 `await`。
标注新资源还出现名为 `annotation_queues.annotation_queues` 的生成式方法，和 convenience API 并存。

### Feedback 不是判定协议

`score=None`、没有该 key、评估器抛错、目标被忽略与测试被跳过是不同事件。
LangSmith 没有一个共同返回类型表达这些差异，也没有内建阈值把它们折叠为 CI 状态。

Python 在能推断 key 时可能写无分错误 feedback，TS 常省略失败 feedback。
同一个 dashboard 平均值可能因此只包含成功子集；作者必须额外核对分母。见 S4 至 S7。

### 服务端状态会影响复现

Evaluator、prompt、feedback config、dataset binding、filter 与 sampling 可在 UI 修改。
同一个 workspace evaluator 的修改会作用到它附着的所有项目和数据集。见 S11。

SDK 可固定包版本，在线 Judge 也可引用 prompt commit。
但一次实验并不会自动成为含 SDK、托管配置、模型、数据集、trace 与 Judge 输入的单文件 artifact。

### Assertions 的名字容易误导

LangSmith Assertions 是 `outputs.assertions` 中的自然语言要求。
它没有执行语义，`must_` 前缀也没有特殊处理；真正的判分完全属于后续 evaluator。见 S15。

因此不能把它类比为 NiceEval 的可执行断言。
它更接近“从人工审阅中采集的参考 rubric 条目”。

### 与 NiceEval 不做一一映射

- LangSmith `Feedback` 不是 NiceEval Verdict。一个 Run 可以有多个互不折叠的 feedback，低分也不等于失败。
- LangSmith repetition 是重复目标 Run，不自带 NiceEval 的 attempt 判定与折叠规则。
- LangSmith Summary feedback 是实验级指标，不等于逐条 assertion 的组合语义。
- LangSmith Comparative Experiment 是既有 Run 的评分任务，不等于重新执行候选系统。
- LangSmith Annotation Queue 是人工协作流程，不应放进 NiceEval core 的执行模型。
- LangSmith Assertions 是数据集字段约定，不应借其名称解释 NiceEval 的断言 API。

## 11. 对 NiceEval 可吸收与不应复制

以下全部是研究判断，不改变 NiceEval 既有契约。

### 可吸收

1. 允许 evaluator 只声明所需投影，如 outputs 与 reference outputs；内部再归一化为显式强类型结果。
2. 同时保存评价目标 ID 与评价计算 ID，让用户从分数直达 Judge trace。
3. 明确区分逐项评价、全组汇总和候选间比较，不让一个 callback 猜自己的生命周期。
4. 成对比较提供顺序随机化，并把同一次比较的多个候选分数归组。
5. repetitions 保存每次原始结果，再把平均值与标准差视为派生读数。
6. 支持只用既有应用输出重算 scorer，同时显示 scorer 版本与原 Run 的版本关系。
7. 测试框架适配器同时提供本地断言失败和报告侧评价，但两者的数据类型保持分离。
8. 从 trace 审阅生成可复用 rubric 的工作流值得吸收，但应为数据采集能力取不歧义的名字。
9. feedback config 的量纲、方向和分类标签可以成为报告展示输入，但不能代替 Verdict 规则。

### 不应复制

1. 不复制“缺少 feedback 也可能只是 evaluator 出错”的含混状态。错误、跳过、无分和失败应能区分。
2. 不复制 Python、TS 与在线 UI 三套近似协议；公开字段、默认值和异步语义应一致。
3. 不把低分是否失败留给每个调用脚本重复发明。若产品提供 gate，应有显式契约与分母规则。
4. 不把核心评价定义只留在可变 UI 资源中。报告应能指出所用定义的固定版本或内容摘要。
5. 不让写评价默默改变数据保留费用。保留期副作用应显式呈现并可审计。
6. 不把自然语言 rubric 条目命名为可执行 assertion，除非它确实有求值与失败语义。
7. 不把 provider 特定 prompt 常量放进 core。可复用 Judge 模板应留在中立边界之外。
8. 不让远端 Experiment 成为唯一 artifact。关键结果、定义与诊断关系应有可携带表示。

## 12. 无法核实项

以下问题在观察日的一手网页、固定 SDK 与 OpenEvals 仓库中没有足够证据。
本文不根据 UI 文案或类型名补猜行为。

1. pytest 的 skip、xfail、xpass 在 LangSmith 实验中各写什么 Run 与 feedback，官方 pytest 页没有定义。
2. Vitest/Jest `.skip` 会阻止回调，但官方页没有说明服务端是否创建 Example、空实验行或跳过状态。
3. 在线 Code 对空字典、非数值值、重复 key 与函数抛错的重试和无分语义，网页只规定正常返回字典。
4. 在线 Judge 的结构化输出失败会写错误 feedback、只写日志还是重试，公开管理 API 没有执行状态协议。
5. `client.evaluators` 管理定义，但公开示例没有给出完整的项目附着、filter、sampling 与 backfill API 调用链。
6. Python `evaluate_comparative` 的类型标注是两个实验，运行时只检查“至少两个”，文档又说该入口可比较两个以上。
7. `upload_results=False` 被标为 beta；其结果对象与本地 trace 形状没有稳定兼容承诺。
8. UI 对 `score=None`、缺失 feedback、布尔值与 repetitions 的精确聚合分母没有在所读页面定义。
9. Composite 遇到 `NaN`、零权重、越界分数或组成指标后来被删除时的精确行为没有公开说明。
10. Assertions 功能页明确写 UI-only，但生成队列资源公开了未解释的 `is_assertion` 字段；其请求效果与稳定性无法核实。
11. 生成式 annotation queue `items` 资源刚进入固定 SDK；其与旧 convenience API 的长期稳定边界尚无迁移总表。
12. 多轮在线评估的七日、500 thread 与十 evaluator 限制被官方注明可能变化，不能当长期契约。
13. TS `StringEvaluator` 仍公开且源码未标弃用，但官方推荐路径已转向 OpenEvals；其长期状态无法仅凭导出判断。
14. Experiment、trace 与 evaluator 的实际费用及保留天数取决于账户方案，本文没有把价格页当 API 契约。
15. Python `create_feedback` 公开 `error=True` 与 `error=False`，但方法文档与 feedback 页面没有说明它对展示或聚合的影响。
16. TS 比较实验缺少参考数据集时，固定客户端不会在本地拒绝；服务端的错误类型与消息没有在所读材料中定义。
17. TS trajectory Judge 接受 `schema`，但实现和公开返回类型没有定义结构化对象如何归一化；观察版本不能核实其稳定语义。
