# Inspect AI 的 Scorer、Judge 与聚合作者面

本文研究 Inspect AI 怎样让 Eval 作者定义单样本判分、裁判模型、跨样本 metric 与跨 epoch reducer。
观察日期是 2026-08-09。

文中的“官方事实”来自 Inspect AI 官方仓库、官方文档、官方 API reference 与 PyPI 发布元数据。
“研究判断”是本文对作者体验和 NiceEval 设计边界的分析，不代表 Inspect AI 的自我描述。

## 1. 定位与真实边界

**官方事实。** Inspect AI 是 Python Eval 框架，不是通用测试断言库。
一个 `Task` 组合 Dataset、Solver 与 Scorer。
Solver 把 `Sample.input` 变成模型输出，Scorer 把单个样本的 `TaskState` 与 `Target` 变成 `Score`，Metric 再汇总一批 Score。
完整分层见官方 [判分总览](https://inspect.aisi.org.uk/%73coring.html) 与固定版本的 [总览正文](https://github.com/UKGovernmentBEIS/inspect_ai/blob/2a08d6316db1ea7e0b37cededc6bc571fdeec6d5/docs/%73coring.qmd)。

**研究判断。** Inspect 最接近“样本 scorer + 实验统计框架”。
它不提供 Jest 式 `expect()`，也不把错误答案变成 Python 异常。
错误答案通常是 `Score(value="I")` 或数值 0；运行异常才进入 `EvalLog.status="error"` 与 `fail_on_error`。

以下能力属于本文范围：

- `Scorer` protocol、`Score`、`Target`、`TaskState` 与 `Task` 的判分配置。
- 内置文本、选择题、数学、F1、裁判模型与 perplexity scorer。
- 自定义 scorer、多个 scorer、复合 Score、metric 与 epoch reducer。
- 无分、运行失败、跳过、日志诊断、离线再次判分、人工改分与 CI 读取。
- 作为 scorer 使用的 Inspect Scout scanner，以及依赖已得分样本的 early stopping。

以下能力不作逐项盘点：

- 与判分无直接关系的模型 Provider、部署方式、工具目录和观测 SDK。
- Inspect Evals 仓库中每个 benchmark 自带的专用 scorer。
- Inspect Scout 的完整 scanner catalog；本文只说明它怎样进入 `Task.scorer`。

Inspect 的 Scorer 主要回答“这个样本得到什么值”。
它可读取消息、模型输出、Sample metadata、Store 和 Sandbox，但没有一等的 Run、turn 或 tool-call assertion receiver。
Agent 行为检查通常由自定义 scorer 或 scanner 自己读取 `TaskState`、transcript 与 Sandbox。

## 2. 观察版本和一手链接

### 2.1 版本快照

| 项目 | 观察值 | 官方材料 |
|---|---|---|
| Python 包 | `inspect-ai==0.3.254` | [PyPI 0.3.254](https://pypi.org/project/inspect-ai/0.3.254/) |
| Git tag | `0.3.254` | [tag 树](https://github.com/UKGovernmentBEIS/inspect_ai/tree/0.3.254) |
| Git commit | `2a08d6316db1ea7e0b37cededc6bc571fdeec6d5` | [固定 commit](https://github.com/UKGovernmentBEIS/inspect_ai/commit/2a08d6316db1ea7e0b37cededc6bc571fdeec6d5) |
| commit 时间 | 2026-08-08 20:21:16 -04:00 | [commit metadata](https://github.com/UKGovernmentBEIS/inspect_ai/commit/2a08d6316db1ea7e0b37cededc6bc571fdeec6d5) |
| PyPI 上传时间 | wheel 为 2026-08-09 00:22:02 UTC；sdist 为 00:22:08 UTC | [PyPI JSON](https://pypi.org/pypi/inspect-ai/0.3.254/json) |
| Python 要求 | `>=3.10` | [pyproject.toml](https://github.com/UKGovernmentBEIS/inspect_ai/blob/2a08d6316db1ea7e0b37cededc6bc571fdeec6d5/pyproject.toml) |
| 成熟度 | PyPI classifier 为 Beta | [pyproject.toml](https://github.com/UKGovernmentBEIS/inspect_ai/blob/2a08d6316db1ea7e0b37cededc6bc571fdeec6d5/pyproject.toml) |

tag、`main` 与 PyPI 发布在观察时指向同一 commit。
PyPI wheel 的 SHA-256 是 `e8176a7e1db5dd8ac5cf5a6a0cb3486d10416e0592e7b9fb760ea831cb76e10d`。
sdist 的 SHA-256 是 `69b47e12922b371f0fb0eba75ad07cb6cebcbba30d95292be319d25554134162`。

### 2.2 一手材料索引

| 编号 | 负责核对的事实 | 固定版本材料 | 易读网页 |
|---|---|---|---|
| A1 | 安装、首个 Task | [index.qmd](https://github.com/UKGovernmentBEIS/inspect_ai/blob/2a08d6316db1ea7e0b37cededc6bc571fdeec6d5/docs/index.qmd) | [Inspect 首页](https://inspect.aisi.org.uk/) |
| A2 | scorer 公开导出与 deprecated alias | [scorer/__init__.py](https://github.com/UKGovernmentBEIS/inspect_ai/blob/2a08d6316db1ea7e0b37cededc6bc571fdeec6d5/src/inspect_ai/scorer/__init__.py) | [Scorer API reference](https://inspect.aisi.org.uk/reference/inspect_ai.scorer.html) |
| A3 | `Scorer` protocol 与 `@scorer` | [_scorer.py](https://github.com/UKGovernmentBEIS/inspect_ai/blob/2a08d6316db1ea7e0b37cededc6bc571fdeec6d5/src/inspect_ai/scorer/_scorer.py) | [Custom Scorers](https://inspect.aisi.org.uk/custom-scorers.html) |
| A4 | `Score`、`ScoreEdit`、metric protocol、值转换 | [_metric.py](https://github.com/UKGovernmentBEIS/inspect_ai/blob/2a08d6316db1ea7e0b37cededc6bc571fdeec6d5/src/inspect_ai/scorer/_metric.py) | [Scorer API reference](https://inspect.aisi.org.uk/reference/inspect_ai.scorer.html) |
| A5 | `Target` | [_target.py](https://github.com/UKGovernmentBEIS/inspect_ai/blob/2a08d6316db1ea7e0b37cededc6bc571fdeec6d5/src/inspect_ai/scorer/_target.py) | [Scorer API reference](https://inspect.aisi.org.uk/reference/inspect_ai.scorer.html) |
| A6 | `TaskState` | [_task_state.py](https://github.com/UKGovernmentBEIS/inspect_ai/blob/2a08d6316db1ea7e0b37cededc6bc571fdeec6d5/src/inspect_ai/solver/_task_state.py) | [Solver API reference](https://inspect.aisi.org.uk/reference/inspect_ai.solver.html) |
| A7 | 内置 scorer | [scorer 源码目录](https://github.com/UKGovernmentBEIS/inspect_ai/tree/2a08d6316db1ea7e0b37cededc6bc571fdeec6d5/src/inspect_ai/scorer) | [Standard Scorers](https://inspect.aisi.org.uk/standard-scorers.html) |
| A8 | 裁判模型、安全处理 | [_model.py](https://github.com/UKGovernmentBEIS/inspect_ai/blob/2a08d6316db1ea7e0b37cededc6bc571fdeec6d5/src/inspect_ai/scorer/_model.py) | [Model Grading](https://inspect.aisi.org.uk/model-graded.html) |
| A9 | 多 scorer 与复合 Score | [_multi.py](https://github.com/UKGovernmentBEIS/inspect_ai/blob/2a08d6316db1ea7e0b37cededc6bc571fdeec6d5/src/inspect_ai/scorer/_multi.py) | [Multiple Scorers](https://inspect.aisi.org.uk/multiple-scorers.html) |
| A10 | 内置 metric | [_metrics 目录](https://github.com/UKGovernmentBEIS/inspect_ai/tree/2a08d6316db1ea7e0b37cededc6bc571fdeec6d5/src/inspect_ai/scorer/_metrics) | [Metric 文档](https://inspect.aisi.org.uk/metrics.html) |
| A11 | reducer protocol 与内置 reducer | [_reducer 目录](https://github.com/UKGovernmentBEIS/inspect_ai/tree/2a08d6316db1ea7e0b37cededc6bc571fdeec6d5/src/inspect_ai/scorer/_reducer) | [Reducing Epochs](https://inspect.aisi.org.uk/metrics.html#reducing-epochs) |
| A12 | `Task` 的 scorer、metrics、epochs 与错误配置 | [task.py](https://github.com/UKGovernmentBEIS/inspect_ai/blob/2a08d6316db1ea7e0b37cededc6bc571fdeec6d5/src/inspect_ai/_eval/task/task.py) | [Task API reference](https://inspect.aisi.org.uk/reference/inspect_ai.html) |
| A13 | 再次判分与 `inspect score` | [_eval/score.py](https://github.com/UKGovernmentBEIS/inspect_ai/blob/2a08d6316db1ea7e0b37cededc6bc571fdeec6d5/src/inspect_ai/_eval/score.py) | [判分工作流](https://inspect.aisi.org.uk/%73coring-workflow.html) |
| A14 | 结果 schema、无分计数 | [log/_log.py](https://github.com/UKGovernmentBEIS/inspect_ai/blob/2a08d6316db1ea7e0b37cededc6bc571fdeec6d5/src/inspect_ai/log/_log.py) | [Log API reference](https://inspect.aisi.org.uk/reference/inspect_ai.log.html) |
| A15 | 人工改分与 metric 重算 | [log/_score.py](https://github.com/UKGovernmentBEIS/inspect_ai/blob/2a08d6316db1ea7e0b37cededc6bc571fdeec6d5/src/inspect_ai/log/_score.py) | [Editing Logs](https://inspect.aisi.org.uk/eval-logs.html#sec-eval-log-modification) |
| A16 | 运行错误与 `score_on_error` | [handling-errors.qmd](https://github.com/UKGovernmentBEIS/inspect_ai/blob/2a08d6316db1ea7e0b37cededc6bc571fdeec6d5/docs/handling-errors.qmd) | [Handling Errors](https://inspect.aisi.org.uk/errors-and-limits.html) |
| A17 | viewer、答案与解释诊断 | [log-viewer.qmd](https://github.com/UKGovernmentBEIS/inspect_ai/blob/2a08d6316db1ea7e0b37cededc6bc571fdeec6d5/docs/log-viewer.qmd) | [Log Viewer](https://inspect.aisi.org.uk/log-viewer.html) |
| A18 | scanner 进入 scorer 槽位 | [scanners.qmd](https://github.com/UKGovernmentBEIS/inspect_ai/blob/2a08d6316db1ea7e0b37cededc6bc571fdeec6d5/docs/scanners.qmd) | [Scanners](https://inspect.aisi.org.uk/scanners.html) |
| A19 | Early stopping | [_early_stopping.py](https://github.com/UKGovernmentBEIS/inspect_ai/blob/2a08d6316db1ea7e0b37cededc6bc571fdeec6d5/src/inspect_ai/util/_early_stopping.py) | [Early Stopping](https://inspect.aisi.org.uk/early-stopping.html) |
| A20 | 本版本变更 | [CHANGELOG.md](https://github.com/UKGovernmentBEIS/inspect_ai/blob/2a08d6316db1ea7e0b37cededc6bc571fdeec6d5/CHANGELOG.md) | [滚动 changelog](https://inspect.aisi.org.uk/CHANGELOG.html) |

后文写“见 A7”时，指这张表中固定 commit 的官方材料。
滚动网页可能在观察日之后变化，因此 signature 冲突时以固定源码为准。

## 3. 安装、最小项目与首个可运行 Eval

### 3.1 安装

官方安装入口是 `pip install inspect-ai`，Python 下限是 3.10，见 A1 与发布元数据。
以下命令把研究版本固定下来，并选用官方首页展示的 OpenAI 接入形状：

```bash
mkdir inspect-demo
cd inspect-demo
python -m venv .venv
source .venv/bin/activate
python -m pip install "inspect-ai==0.3.254" openai
export OPENAI_API_KEY="your-openai-api-key"
```

把 API key 放进本机的 secret 管理或未提交的 shell 配置。
Inspect 官方明确提醒不要提交含 key 的 `.env` 文件，见 [Options](https://inspect.aisi.org.uk/options.html#environment-variables)。

### 3.2 最小文件

新建 `capitals.py`：

```python
from inspect_ai import Task, task
from inspect_ai.dataset import Sample
from inspect_ai.scorer import match
from inspect_ai.solver import generate


@task
def capitals() -> Task:
    return Task(
        dataset=[
            Sample(
                input="Answer with only the city name: What is the capital of France?",
                target="Paris",
            ),
        ],
        solver=generate(),
        scorer=match(location="exact"),
    )
```

这个形状与官方 [Standard Scorers 最小例子](https://inspect.aisi.org.uk/standard-scorers.html) 相同。
`@task` 注册入口，`Sample.target` 进入 `Target`，`generate()` 填充 `TaskState.output`，`match()` 返回单样本 Score。

### 3.3 运行与查看

```bash
inspect eval capitals.py --model openai/gpt-5
inspect view
```

第一次命令默认在 `./logs` 写 `.eval` 文件，并在终端显示 metric。
第二次命令在本机启动 Inspect View，读者可展开样本的 Messages、判分详情与 Metadata，见 A17。

若只想先生成回答、稍后调 scorer，可运行：

```bash
inspect eval capitals.py --model openai/gpt-5 --no-score
inspect_log_file="$(inspect log list --log-dir ./logs | head -n 1)"
inspect score "$inspect_log_file"
```

`--no-score` 省去本轮判分，但仍持久化模型输出。
`inspect score` 随后从 log 恢复 `TaskState` 并执行原 scorer，详见 A13。

## 4. 核心数据流与对象关系

### 4.1 从 Sample 到 EvalResults

```text
Sample(input, target, metadata, choices)
        │
        ▼
Task ── Solver / Agent ──► TaskState(output, messages, store, ...)
                                │
                                ├── async Scorer(state, Target) ──► Score
                                │                                   │
                                │                         多 epoch  │ ScoreReducer
                                │                                   ▼
                                └────────────────────────────► SampleScore
                                                                    │
                                                                    ▼
                                                              sync Metric
                                                                    │
                                                                    ▼
                                               EvalScore / EvalResults / EvalLog
```

**官方事实。** Scorer 对每个样本异步运行；Metric 对一批 `SampleScore` 同步运行；Reducer 对同一 sample id 的多 epoch Score 同步运行。
`Task(metrics=...)` 会替换 scorer 自带的 metrics，不是追加，见 A10 与 A12。

### 4.2 对象关系

| 对象 | 作者提供或读取的内容 | 生命周期 | 一手材料 |
|---|---|---|---|
| `Sample` | `input`、`target`、`metadata`、`choices` | Dataset 中的题目定义 | [Datasets](https://inspect.aisi.org.uk/datasets.html) |
| `Task` | Dataset、Solver、Scorer、Metric、Epochs | 一项 Eval 定义 | A12 |
| `TaskState` | 单样本执行状态与最终 `ModelOutput` | Solver 与 Scorer 共享 | A6 |
| `Target` | 一个或多个目标字符串 | Scorer 调用期间 | A5 |
| `Score` | 值、提取答案、解释、metadata、改分历史 | 一个 scorer 对一个样本的结果 | A4 |
| `SampleScore` | Score 加 sample id、Sample metadata 与 scorer 名 | Metric 输入 | A4 |
| `ScoreReducer` | 同一样本多个 epoch 的 `list[Score]` | Metric 之前 | A11 |
| `Metric` | 一批 `list[SampleScore]` | Eval 汇总阶段 | A10 |
| `EvalScore` | scorer、reducer、metric、已得分数与无分数 | EvalLog 汇总结果 | A14 |

### 4.3 三种“多个分数”

| 需求 | API 形状 | 保存结果 | 执行特征 |
|---|---|---|---|
| 完全独立的检查 | `Task(scorer=[a(), b()])` | 每个 scorer 各留一个具名 Score | Task runner 逐个调用 |
| 共用一次昂贵计算 | 一个 scorer 返回 `Score(value={...})` | dict key 展开为多个汇总项 | 只做一次共享计算 |
| 多个 scorer 投票为一个值 | `multi_scorer([...], reducer="mode")` | 只保留 reducer 返回的 Score | 子 scorer 并行执行 |

官方把这三种模式并列说明，见 A9。
`multi_scorer()` 与 Task 的 scorer 列表并不等价：前者丢掉独立子分数，只返回聚合后的单一 Score。

### 4.4 错误、无答案、无分与跳过

| 状态 | 作者写法或触发条件 | 是否进入 metric | 可见事实 |
|---|---|---|---|
| 明确错误答案 | `Score(value=INCORRECT)` | 是，默认转成 0 | Score、answer、explanation |
| 拒答或未提取到答案 | `Score(value=NOANSWER)` | 是，默认转成 0 | 值为 `"N"` |
| 没有足够证据判分 | `Score.unscored(...)` | 否 | 根级 `NaN`，并计入 `EvalScore.unscored_samples` |
| scorer 主动不产出 | 返回 `None` | 否 | 该 scorer 的样本 Score 不写入，也不等同于无分计数 |
| scorer 抛异常 | Python exception | 否 | 样本进入 error；较早 scorer 的结果可能已存在 |
| Solver 抛异常 | 默认行为 | 否 | 样本 error，受 `fail_on_error` 管理 |
| 错误样本仍判分 | `score_on_error=True` | 是 | 同时保留 `error` 与 `scores` |
| Early stopping | `schedule_sample()` 返回 `EarlyStop` | 否 | 写入 `EarlyStoppingSummary`，不产生 Score |

这些状态不能用一个 `passed` 布尔值代替。
尤其不要用 `None` 表达“证据不足”：A3、A4 与结果计算源码显示，只有 `Score.unscored()` 形成可审计的无分事实。

`EvalScore` 没有 `skipped_samples` 字段。
返回 `None` 只能从缺失的逐题 Score 与计数差额推知，也可能与执行错误或 early stopping 混在一起，见 A14。

## 5. 完整 API catalog

### 5.1 调用约定

下面的 catalog 以 `inspect_ai.scorer.__all__` 为公开清单，再补充直接承载判分配置的 `Task`、`TaskState`、log 与 early stopping。
固定清单见 A2；表内的 A 编号都指第 2 节的一手材料。

| 层 | 作者实现或调用的 signature | 同步性 | 值怎样向下游流动 |
|---|---|---|---|
| Scorer factory | `def factory(...) -> Scorer` | 同步 | 创建并注册 scorer；参数可写进 log |
| `Scorer` | `async __call__(state: TaskState, target: Target) -> Score | None` | 异步 | 每个样本产生一个 Score，或不产生结果 |
| `ScoreReducer` | `__call__(scores: list[Score]) -> Score` | 同步 | 合并同一 sample id 的多个 epoch |
| `MetricProtocol` | `__call__(scores: list[SampleScore]) -> Value` | 同步 | 汇总 scorer 或 reducer 给出的样本值 |

Scorer 可等待模型、Sandbox 或其它 I/O。
Metric 与 reducer 必须在同步函数内完成；需要昂贵 I/O 的判断应留在 scorer，见 A3、A4 与 A11。

### 5.2 Scorer protocol、注册与运行中判分

| API | 完整公开形状 | 参数、返回与默认值 | 失败、跳过和无分 | 材料 |
|---|---|---|---|---|
| `Scorer` | `async (TaskState, Target) -> Score | None` | 无额外默认值；调用由 runner 发起 | 异常使样本出错；`None` 省略该结果；`Score.unscored()` 才形成无分 | A3 |
| `scorer` | `@scorer(metrics, name=None, **metadata)` | `metrics` 必填；可用 metric 列表、按 Score key 的 dict，或两者的列表；返回同步 factory decorator | factory 返回值若不是 async callable，会抛 `TypeError` | A3 |
| `score` | `await score(conversation: ModelConversation) -> list[Score]` | 可传 `TaskState` 或 `AgentState`；执行当前 Task 的所有 scorer | 只能在含 scorer 的 Task 内调用，否则抛 `RuntimeError`；省略子 scorer 的 `None` | [A2 的 `_score.py`](https://github.com/UKGovernmentBEIS/inspect_ai/blob/2a08d6316db1ea7e0b37cededc6bc571fdeec6d5/src/inspect_ai/scorer/_score.py) |
| `multi_scorer` | `multi_scorer(scorers: list[Scorer], reducer: str | ScoreReducer) -> Scorer` | 子 scorer 并行；reducer 可用注册名或对象；继承首个可识别子 scorer 的 metrics | 过滤 `None`；全部为 `None` 时返回 `Score.unscored()`；子异常向外抛 | A9 |

运行中 `score()` 会写一个 `intermediate=True` 的 `ScoreEvent`，但最终返回的 `list[Score]` 不带 scorer 名。
它适合让 agent 根据阶段性得分调整动作，不替代 Task 结束时的最终 scorer 调用，见 A2 的 `_score.py`。

Task runner 会拒绝 scorer 改写 `state.scores`。
作者可以读取已有值，但应把新结果作为返回值交给 runner，见 [scorer runner](https://github.com/UKGovernmentBEIS/inspect_ai/blob/2a08d6316db1ea7e0b37cededc6bc571fdeec6d5/src/inspect_ai/_eval/task/run.py)。

Task scorer 列表按次序运行，后项可读取 runner 已写入的前项分数。
`multi_scorer()` 的子项并行，不能把同一轮子分数当成依赖链；它们只在 reducer 处汇合。

### 5.3 `Score`、`Value`、`Target` 与 `SampleScore`

#### `Score` 和值类型

| API 或字段 | 类型、默认值与行为 | 失败或特殊语义 | 材料 |
|---|---|---|---|
| `Value` | scalar `str | int | float | bool`；这些 scalar 的 sequence；或 `Mapping[str, scalar | None]` | dict 的 `None` 是分量无值，不等同根级无分 | A4 |
| `Score(value, answer=None, explanation=None, metadata=None, history=[])` | Pydantic model；`value` 必填；其余字段可省 | 非 scalar 用 scalar accessor 会抛 `ValueError` | A4 |
| `Score.unscored(*, answer=None, explanation=None, metadata=None)` | 构造根级 `value=NaN` 的 Score | metric 和 reducer 跳过；log 保留上下文并累计无分数 | A4、A14 |
| `text`、`as_str()` | scalar 转 `str` | list 或 dict 会抛 `ValueError` | A4 |
| `as_int()`、`as_float()`、`as_bool()` | 使用 Python 的 scalar 转换 | 不合法转换沿用 Python 异常 | A4 |
| `as_list()` | 返回 `list[str | int | float | bool]` | 非 list 抛 `ValueError` | A4 |
| `as_dict()` | 返回 `dict[str, scalar | None]` | 非 dict 抛 `ValueError` | A4 |
| `ScoreEdit` | `value/answer/explanation/metadata` 默认 `UNCHANGED`；`provenance=None` | metadata 是整体替换，不是合并；旧状态留在 `history` | A4、A15 |
| `UNCHANGED` | 字面量 sentinel | 只用于改分；新建 Score 时不能把它当 `value` | A4、A15 |

`CORRECT="C"`、`INCORRECT="I"`、`PARTIAL="P"`、`NOANSWER="N"` 是普通字符串常量。
默认 `value_to_float()` 分别映射为 1、0、0.5、0，见 A4。

`Score.unscored()` 只构造根级 `NaN`。
dict Score 的某个 key 也可单独为 `NaN`；按 key metric 会只把该分量计为无分，其它 key 仍可汇总，见 A14 的结果计算源码。

内置 reducer 会跳过根级 `NaN`，也会按 dict key 或 list 位置跳过 `NaN` 分量。
普通 metric 不会自动拆 list／dict；应配置按 key metrics，或使用明确接受容器的自定义 metric。

```text
value_to_float(
    correct: Value = CORRECT,
    incorrect: Value = INCORRECT,
    partial: Value = PARTIAL,
    noanswer: Value = NOANSWER,
) -> ValueToFloat
```

它还把 `yes/true` 映射为 1，把 `no/false` 映射为 0，并转换有限数字字符串。
未知字符串、list 与 dict 会给 warning 并返回 0；这不是无分。
`ValueToFloat` 是 `Callable[[Value], float]` 的公开类型别名。

#### `Target`

| API | 行为 | 边界 | 材料 |
|---|---|---|---|
| `Target(target: str | list[str])` | 把单字符串包成一项列表 | 不验证列表非空 | A5 |
| `target.target` | 原始 `list[str]` | 作者若改动它，也会改变后续访问 | A5 |
| sequence API | `len(target)`、索引、切片与迭代 | 多个目标通常表示任一可接受答案 | A5 |
| `target.text` | `"".join(target.target)` | 多项之间没有分隔符；不适合无损表达多个 rubric 段 | A5 |

#### `SampleScore` 与 metric 输入

```text
SampleScore(
    score: Score,
    sample_id: str | int | None = None,
    sample_metadata: dict[str, Any] | None = None,
    scorer: str | None = None,
)
```

`sample_metadata_as(ModelType)` 在 metadata 存在时返回经校验的 Pydantic model，否则返回 `None`。
`scorer` 是注册名；自定义 metric 不应靠列表位置猜 scorer 身份，见 A4。

### 5.4 Scorer 可读取的 `TaskState`

`TaskState` 不是只含 completion 的薄对象。
以下是 0.3.254 的公开读取面；类型与属性行为见 A6。

| 成员 | 类型或返回值 | 判分用途与边界 |
|---|---|---|
| `model` | `ModelName` | 被评模型名 |
| `sample_id` | `int | str` | 对齐题目；同一 id 可有多个 epoch |
| `epoch` | `int` | 当前重复序号 |
| `uuid` | `str` | 单次 sample run 的全局唯一 id |
| `input` | `str | list[ChatMessage]` | Sample 的初始输入；官方要求视为不可变 |
| `input_text` | `str` | 字符串输入本身，或消息列表中最后一条 user 文本；找不到时抛 `ValueError` |
| `user_prompt` | `ChatMessageUser` | 可读写当前 user prompt；没有 user 消息时抛异常 |
| `target` | `Target` | 当前目标；Scorer 的第二个参数是同一概念的显式入口 |
| `metadata` | `dict[str, Any]` | Sample metadata，可赋新 dict |
| `metadata_as(T)` | `T` | 绑定为 Pydantic model；空 metadata 时抛 `ValueError` |
| `messages` | `list[ChatMessage]` | 完整对话，可被 solver 与 scorer 检查 |
| `output` | `ModelOutput` | 最终模型输出；常用 `output.completion`、`choices` 与 logprobs |
| `store` | `Store` | solver／agent 写入的样本状态 |
| `store_as(T, instance=None)` | `T` | 把 Store 绑定为具名 `StoreModel` |
| `tools` | `list[Tool]` | 样本可用工具；setter 也接受 `ToolDef` |
| `tool_choice` | `ToolChoice | None` | 工具选择指令 |
| `choices` | `Choices` | 选择题选项、原始位置与 solver 标出的 `correct` |
| `message_limit` | `int | None` | 消息上限；setter 会立即检查已用量 |
| `token_limit` | `int | None` | token 上限；setter 会立即检查已用量 |
| `token_limit_type` | `str` | `all` 或该样本初始化时选定的计量类型 |
| `token_usage` | `int` | 当前样本累计 token |
| `cost_limit` | `float | None` | 当前样本美元上限；setter 会立即检查 |
| `cost_usage` | `float` | 当前样本累计美元成本 |
| `completed` | `bool` | solver 是否标记完成 |
| `scores` | `dict[str, Score] | None` | 已有得分；runner 管理最终写入 |
| `max_messages` | `int | None` | deprecated alias；改用 `message_limit` |

安全相关检查不应只看 `output.completion`。
例如工具调用参数在 `messages`，agent 的结构化状态可能在 `store`，文件副作用则需要 scorer 访问 Task 配置的 Sandbox。

### 5.5 `Task` 上与判分直接有关的配置

| 参数 | 类型与默认值 | 精确语义 | 材料 |
|---|---|---|---|
| `scorer` | `Scorer | Scanner | Sequence[...] | None = None` | 一个或多个判分器；列表由 runner 逐个执行 | A12、A18 |
| `metrics` | metric 列表或按 Score key 的 dict；默认 `None` | 非 `None` 时替换 scorer 自带 metrics，不做追加 | A12 |
| `model` | `str | Model | None = None` | Task 的被评模型；`None` 使用 eval 模型，未显式选 Judge 时也可能成为裁判模型 | A8、A12 |
| `model_roles` | `dict[str, str | Model] | None = None` | 给 `model_graded_*` 的 `model_role="grader"` 这类命名角色绑定模型 | A8、A12 |
| `config` | `GenerateConfig = GenerateConfig()` | 被评模型的生成配置；perplexity scorer 需要启用 `prompt_logprobs` | A7、A12 |
| `sandbox` | `SandboxEnvironmentType | None = None` | 给 solver 和自定义 scorer 提供样本级文件／命令边界 | A6、A12 |
| `cleanup` | `Callable[[TaskState], Awaitable[None]] | None = None` | 在 solver 与所有 scorer 之后运行；即使样本异常也调用 | A12 |
| `epochs` | `int | Epochs | None = None` | `None` 运行一次；`Epochs(n)` 重复样本并默认使用 `mean` reducer | A11、A12 |
| `fail_on_error` | `bool | float | None = None` | `None` 采用有效默认值 `True`；也可关闭，或按错误比例／数量设阈值 | A12、A16 |
| `continue_on_fail` | `bool | None = None` | 有效默认值 `False`，达到错误阈值立即停止；`True` 则继续到末尾 | A12、A16 |
| `score_on_error` | `bool | None = None` | 有效默认值 `False`；`True` 在重试用尽后仍判分，错误仍计入失败阈值 | A12、A16 |
| `early_stopping` | `EarlyStopping | None = None` | 在排入样本前允许跳过，并接收已完成样本分数 | A19 |

`fail_on_error` 管的是执行异常，不是 `INCORRECT`。
想让 CI 因准确率过低失败，必须读取 `EvalLog.results` 并自行设门槛，见第 7 节。

`epochs_reducer` 是 deprecated Task 参数，应改成 `epochs=Epochs(n, reducer=...)`。
`TaskState.max_messages`、`EvalSample.score`、`EvalResults.scorer` 与 `EvalResults.metrics` 也属于旧面，见 A12、A14 与 A20。

### 5.6 内置确定性与结构 scorer

本表的 factory 都同步返回 `Scorer`，返回的 scorer 都是异步调用。
除特别说明外，它们总返回 Score，不用 `None` 跳过样本；官方实现见 A7。

| API signature | 比较规则与 Score | 默认 metrics | 失败或无分语义 |
|---|---|---|---|
| `match(location="end", *, ignore_case=True, numeric=False)` | 位置为 `begin/end/any/exact`；逐个 Target 比较；返回 C 或 I，并附提取答案 | `accuracy()`、`stderr()` | 文本不匹配是 I；`numeric=True` 只把有限数字作数字比较 |
| `includes(ignore_case=True)` | 任一 Target 是 completion 子串即 C，否则 I | `accuracy()`、`stderr()` | 空目标会按 Python 子串规则匹配；不是无分 |
| `pattern(pattern, ignore_case=True, match_all=False)` | regex 必须有 capture group；`match_all=False` 时任一捕获匹配目标即可 | `accuracy()`、`stderr()` | regex 没命中返回 N；命中但值错误返回 I；无效 regex 抛异常 |
| `answer(pattern)` | `pattern` 必须是 `"letter"`、`"word"` 或 `"line"`；提取 `ANSWER:` 后内容 | `accuracy()`、`stderr()` | 没有默认 pattern；内部沿用 `pattern()` 的 N／I 语义 |
| `choice()` | 与 `multiple_choice` solver 配合；按原始选项位置判断一个或多个选择 | `accuracy()`、`stderr()` | 选择错误是 I；若 solver 打乱选项，explanation 展示发给模型的次序 |
| `exact()` | casefold、去文章／标点、数字归一与空白归一后精确比较任一 Target | `mean()`、`stderr()` | 任何不等是 I；不产生无分 |
| `f1(answer_fn=None, stop_words=None)` | 对归一后的答案词集合与各 Target 算 F1，取最大值并保留两位小数 | `mean()`、`stderr()` | 返回 0 到 1；空集合按实现的 precision／recall 规则处理 |
| `math()` | 提取最后的 boxed 内容或数值，并以 SymPy 检查数学等价 | `accuracy()`、`stderr()` | factory 缺 `sympy` 时抛依赖异常；无法判成等价时返回 I |

`match(numeric=True)` 会去货币符号、千位分隔符与 Markdown 格式符，但不去 `%`。
它用五位有效数字归一；要同时接受 `60` 与 `60%`，应把两者都放进 Target，见 A7 的 `_match.py`。

`match()` 总会修剪两端空白；非数字路径还会去标点，API 没有公开 `ignore_punctuation` 参数。
`includes()` 则只按 `ignore_case` 决定是否 casefold，不做同一套规范化。

`AnswerPattern.LETTER`、`.WORD`、`.LINE` 是三个公开 regex 枚举值。
它们针对带 `ANSWER:` 前缀的输出；通常直接调用 `answer("letter")`，不必手动拼 regex，见 A7 的 `_answer.py`。

`math()` 支持 boxed 或纯文本答案，并规范化分数、根式、百分数与代数式。
它在 factory 创建时 import SymPy；安装命令是 `python -m pip install sympy`，见 A7 的 `_math.py` 与官方内置 scorer 文档。

### 5.7 Perplexity scorer

| API signature | 输入与返回 | 默认 metrics | 失败或无分语义 | 材料 |
|---|---|---|---|---|
| `perplexity()` | 用首个 output choice 的全部 prompt token logprob；Score.value 是每 token NLL | 两个 perplexity metric | 没 choice、没 prompt logprobs 或 token 为空时根值为 `NaN` | A7 的 `_perplexity.py` |
| `target_perplexity(num_target_tokens=None, target_text_key="target_text")` | 只取 prompt 末尾 N 个 token；N 的优先级是参数、metadata 数量、metadata 文本自动 tokenize、1 | 两个 perplexity metric | 无 choice／logprobs、N≤0 或 logprob 不足时为 `NaN`；tokenize 失败直接抛异常 | A7 的 `_target_perplexity.py` |

两者要求 solver 的 `GenerateConfig.prompt_logprobs` 可用。
成功 Score 的 metadata 含 `num_tokens`、`sum_log_probs` 与单样本 `perplexity`；根值是 NLL，不是 perplexity。

### 5.8 裁判模型 scorer

```text
model_graded_qa(
    template: str | None = None,
    instructions: str | None = None,
    grade_pattern: str | None = None,
    include_history: bool | Callable[[TaskState], str] = False,
    partial_credit: bool = False,
    model: list[str | Model] | str | Model | None = None,
    model_role: str | None = "grader",
) -> Scorer
```

`model_graded_fact()` 的 signature 完全相同。
两者都同步建 factory、异步请求裁判模型，并附 `accuracy()` 与 `stderr()`；差异在默认 prompt，见 A8。
QA 版问 submission 是否满足 criterion；fact 版比较 submission 与 expert answer 的事实内容，并要求忽略文风、语法和标点差异。

| 参数 | 默认行为 | 作者责任与失败语义 |
|---|---|---|
| `template` | QA 版把 Target 当 criterion；fact 版把它当 expert answer | 可用 `{question}`、`{criterion}`、`{answer}`、`{instructions}` 与 Sample metadata；缺 placeholder 会在格式化时抛异常 |
| `instructions` | 要求先说明理由，最后输出 `GRADE: C` 或 `GRADE: I` | `partial_credit` 只改变内置 instructions；自定义文本须自行约束输出 |
| `grade_pattern` | 默认抽取最后一个有单词边界的 `GRADE: [CPI]`，兼容若干零宽空白符 | 自定义 regex 必须有一个 capture group；匹配不到时返回根级无分 |
| `include_history` | `False`，只给原始 Sample 输入 | `True` 发送非 system 的对话片段；也可传 `TaskState -> str`；可能泄露工具输出或秘密 |
| `partial_credit` | `False` | `True` 时内置 instructions 允许 P，默认数值映射为 0.5 |
| `model` | `None` | 字符串或 `Model` 明确选模型；列表让每个模型独立判分，再以 mode 合成一个 Score |
| `model_role` | `"grader"` | 仅在 `model` 未给时使用；角色未绑定则回到被评模型；设 `None` 也直接用被评模型 |

Sample metadata 会作为额外 template 变量。
名为 `question`、`answer`、`criterion` 或 `instructions` 的 metadata key 会先移除，不能替换四个保留变量，见 A8。

成功时，Score.value 是 regex 捕获的值，answer 是被评 completion，explanation 是裁判回复。
`metadata["grading"]` 保存送出的 user message 与裁判回复 message，便于复核。

`model=[...]` 复用 `multi_scorer(..., "mode")`。
最终 log 不保留每位 Judge 的独立 Score；reducer 取第一项 metadata，且只在所有 explanation 完全相同时保留 explanation，见 A8、A9 与 A11。
空模型列表不会抛配置异常，而会因没有子结果得到 `Score.unscored()`。

`partial_credit=False` 只让内置 instructions 不再邀请 P。
默认 regex 仍接受 `[CPI]`，所以 Judge 若自行输出 P，Scorer 仍会返回 P；需要禁止时应给更窄的 `grade_pattern`。
自定义 regex 的捕获值也没有运行时 alphabet 校验；官方要求作者让唯一 capture group 只抽取 C、P 或 I。

默认 regex 大小写不敏感，并以 greedy 前缀选最后一个 verdict。
它不要求 verdict 位于字符串末尾，因此其后的文本不会让匹配失效；普通词中的 `GRADE` 会被单词边界排除。

匹配失败时，API 返回 `Score.unscored()`，并写 `metadata["unscored_reason"]="grade_parse_failure"`。
模型请求失败、template 格式错误或自定义 callback 异常不会变成无分，而会按 scorer 异常处理。

#### Prompt 注入与敏感信息边界

0.3.254 的默认模板用 `[BEGIN DATA]` 与 `[END DATA]` 隔开题目、回答和 criterion。
实现会把这些字面 marker 在 question、answer、criterion 与嵌套 metadata 字符串中改成带连字符的形式，见 A8。

若最终 output message 含 image、audio 或 video，裁判 user message 会附上这些媒体。
文本 submission 会补充附件提示；这会扩大 Judge 请求与 EvalLog 中的敏感数据面。

这个措施只保护该结构 marker。
作者控制的 `instructions` 不经过这一步，自定义 template 也可能失去默认边界；它们都应接受独立安全评审。

`include_history=True` 会扩大裁判看到的内容。
处理秘密或不可信工具输出时，宜保持 `False`，或用 callback 只选必要片段；完整 prompt 仍会进入 Score metadata 与 EvalLog。

内置 history 格式会去掉 system 消息，并保留到最后一条 assistant 消息为止。
其中可含 user 文本、assistant tool-call 参数与此前的 tool 结果；最终 completion 仍单独进入 submission 槽位，见 A8。

传 `Model` 对象可在创建时设温度或 seed。
`model_graded_*` 本身没有 `temperature` 或 `seed` 参数；把这类参数写进它的调用会失败，见 A8 与 [Model API](https://inspect.aisi.org.uk/reference/inspect_ai.model.html)。

### 5.9 Metric protocol、注册与内置 metric

```text
class MetricProtocol(Protocol):
    def __call__(self, scores: list[SampleScore]) -> Value: ...

@metric(name: str | None = None, *, scores: "auto" | "reduced" | "unreduced" = "auto")
def metric_factory(...) -> Metric: ...
```

factory 与 metric 都是同步函数。
`scores="auto"` 在有 reducer 时接收 reduced view；`"reduced"` 强制每个 sample 一个合并值；`"unreduced"` 把每个 epoch 当独立观察，见 A4。

旧 `Metric` 形状 `list[Score] -> Value` 自 0.3.64 起 deprecated，但 0.3.254 仍兼容。
新代码应声明 `MetricProtocol` 并用 `SampleScore.score` 取 Score，见 A4。

| API signature | 返回与默认值 | 空数据、失败与 epoch 语义 | 材料 |
|---|---|---|---|
| `accuracy(to_float=value_to_float())` | 所有转换值之和除以数量，返回 float | 空列表为 0；复杂 Value 默认 warning 后按 0 | A10 |
| `mean(to_float=value_to_float())` | NumPy 均值，返回 float | 空列表为 0；转换规则同上 | A10 |
| `stderr(to_float=value_to_float(), cluster=None)` | 样本均值的标准误；`cluster` 指向 Sample metadata key | 少于两个值或 cluster 时为 0；缺分组 key 抛 `ValueError` | A10 |
| `std(to_float=value_to_float())` | `ddof=1` 的样本标准差 | 少于两个值为 0 | A10 |
| `var(to_float=value_to_float())` | `ddof=1` 的样本方差 | 少于两个值为 0；公开导出，但生成的 API 网页未列出 | A2、A10 |
| `bootstrap_stderr(num_samples=1000, to_float=value_to_float())` | 有放回 bootstrap 的均值标准误 | 空列表为 0；没有 seed 参数，因此重复调用可能不同 | A10 |
| `frequency(categories=None, normalize=True)` | dict：各 category 的比例；`False` 时为计数 | 声明 `scores="unreduced"`；list／dict Score 抛 `TypeError` | A10 |
| `categorical(categories=None)` | 返回 `[frequency(categories)]` | 是 convenience factory，不是一个 Metric | A10 |
| `grouped(metric, group_key, *, all="samples", all_label="all", value_to_float=value_to_float(), name_template="{group_name}")` | dict：各组 metric 与可选总项 | 缺 key 或组名撞 `all_label` 时抛 `ValueError` | A10 |
| `perplexity_per_token()` | `exp(-总 logprob / 总 token)` | 总 token 为 0 时返回 `NaN` | A10 |
| `perplexity_per_seq()` | 各样本 NLL 等权平均后取 exp | 没有有效序列时返回 `NaN` | A10 |

两个 perplexity metric 都要求 Score.metadata 含 `num_tokens` 与 `sum_log_probs`。
字段缺失时会 warning，并把该样本当成零 token、零 logprob；若最终没有有效 token，metric 返回 `NaN`。

`frequency(categories=...)` 接受 `StrEnum` 类型或字符串 sequence。
显式列全 category 可让零次出现的项也以 0 展示；传单个字符串会抛 `TypeError`，避免逐字符拆开。

`grouped(..., all="samples")` 对全体样本再跑一次内层 metric。
`all="groups"` 对各组结果做等权均值；`all=False` 不产生总项。

若 Score.value 是 dict，可在 scorer decorator 使用 `metrics={"*": [accuracy()]}`。
`"*"` 为每个 key 生成独立 `EvalScore`；也可写确切 key，为不同分量配置不同 metrics，见 A4 与 A9。

根级无分在进入 metric 前被去掉。
直接以空列表调用 accuracy／mean 会得到 0。
Eval runner 若发现没有有效 Score，则不调用 metric，而把 metric value 写成 `NaN`；CI 仍须检查 `unscored_samples`。

多 epoch 时，`unscored_samples` 属于具体的 `EvalScore` 视图。
reduced view 只在 reducer 的最终值为根级 `NaN` 时计一项；unreduced view 则逐个 sample／epoch 计数，见 A14。

### 5.10 Epoch reducer

```text
class ScoreReducer(Protocol):
    def __call__(self, scores: list[Score]) -> Score: ...

ScoreReducers = str | ScoreReducer | list[str] | list[ScoreReducer]
Epochs(epochs: int, reducer: ScoreReducers | None = None)
```

`Epochs(n)` 的 `reducer=None` 会在运行时建出 `mean_score()`。
一个 Task 可以配置多个 reducer；每个 scorer／reducer 组合形成独立 `EvalScore`，见 A11 与 A14。
`ScoreReducers` 是单个注册名、单个 reducer、同类列表这四种输入的公开类型别名。

| API signature | 合并算法与返回 | 边界 | 注册名／简写 |
|---|---|---|---|
| `mode_score()` | 每个 scalar 或容器位置取众数；保留原 Value 类型 | 平票取最先出现值 | `"mode"` |
| `mean_score(value_to_float=value_to_float())` | 每个位置先转 float，再取均值 | 未知值默认按 0 | `"mean"` |
| `median_score(value_to_float=value_to_float())` | 每个位置先转 float，再取中位数 | 未知值默认按 0 | `"median"` |
| `max_score(value_to_float=value_to_float())` | 按转换值选最大项，并保留选中项的原 Value | 全部位置无值时该位置为 `NaN` | `"max"` |
| `at_least(k, value=1.0, value_to_float=value_to_float())` | 至少 k 个 epoch 值大于等于阈值则 1，否则 0 | k 大于 Task epochs 时启动前抛 `PrerequisiteError` | `"at_least_<k>"`，如 `"at_least_2"` |
| `pass_at(k, value=1.0, value_to_float=value_to_float())` | 估计从总尝试中抽 k 次至少一次成功的概率 | 有效 epoch 少于 k 时为 `NaN` | `"pass_at_<k>"`，如 `"pass_at_2"` |
| `pass_k(k, value=1.0, value_to_float=value_to_float())` | `C(correct,k) / C(total,k)`，即抽 k 次全部成功概率 | 有效 epoch 少于 k 时为 `NaN` | `"pass_k_<k>"`，如 `"pass_k_2"` |
| `score_reducer(func=None, *, name=None)` | 注册同步 reducer factory | factory 应返回 `list[Score] -> Score` | 自定义名或函数名 |

所有内置 reducer 跳过根级 `NaN`。
全部 epoch 无分时返回根级 `NaN`；dict key 不同或 list 长度不同会抛 `ValueError`，见 A11。

reducer 只在所有输入的 answer 相同时保留 answer，也只在 explanation 全相同时保留 explanation。
metadata 总取第一项，不做合并；自定义 reducer 若要保留投票明细，应自己写 metadata。

`mode_score()` 可直接用于 `multi_scorer()`，但其它 epoch reducer 也能接受这个槽位。
两处输入都是 `list[Score]`，语义却不同：前者合并同一轮的多个判分器，后者合并同一题的多次运行。

### 5.11 Early stopping 与 scanner 边界

`EarlyStopping` 是异步 protocol，不是 scorer 或 reducer，完整定义见 A19。

| 方法或对象 | signature | 语义 |
|---|---|---|
| `start_task` | `async (task: EvalSpec, samples: list[Sample], epochs: int) -> str` | 初始化并返回 manager 名 |
| `schedule_sample` | `async (id: str | int, epoch: int) -> EarlyStop | None` | 返回 `EarlyStop` 就不运行该 sample／epoch；`None` 表示排入执行 |
| `complete_sample` | `async (id, epoch, scores: dict[str, SampleScore]) -> None` | 接收刚完成样本的具名分数 |
| `complete_task` | `async () -> dict[str, JsonValue]` | 返回诊断 metadata |
| `EarlyStop` | `id, epoch, reason=None, metadata=None` | 描述一次跳过 |
| `EarlyStoppingSummary` | `manager, early_stops, metadata` | 写入 `EvalResults.early_stopping` |

Early stopping 依赖已经完成的样本，适合自适应减少后续运行。
被跳过项没有 Score，因此不能把它与 `Score.unscored()` 混为同一统计状态。

Inspect Scout 的 `Scanner[Transcript]` 也能放进 `Task.scorer`。
此时 `Result` 会转成 Score，并用 `@scanner(metrics=...)` 的 metrics 汇总；返回 `None` 的稀疏发现仍是省略结果，见 A18。

作为 scorer 时，scanner 结果进入 EvalLog 的 scores，不写单独的 `scans/` 目录。
在线或离线 scan 才写该目录；scanner 的完整 catalog 属于 Inspect Scout，不属于 Inspect AI scorer API。

### 5.12 过时面与观察期差异

| API | 0.3.254 状态 | 替代项 | 材料 |
|---|---|---|---|
| `bootstrap_std` | relocated deprecated alias；计划在 0.4 移除 | `bootstrap_stderr` | A2、A20 |
| `inspect_ai.scorer.ProvenanceData` | relocated deprecated alias；计划在 0.4 移除 | `inspect_ai.log.ProvenanceData` | A2、A20 |
| 旧 `Metric(list[Score])` | deprecated，但仍支持 | `MetricProtocol(list[SampleScore])` | A4 |
| `Task(epochs_reducer=...)` | deprecated | `Task(epochs=Epochs(...))` | A12 |
| `TaskState.max_messages` | deprecated | `message_limit` | A6 |
| `EvalResults.scorer`、`.metrics` | deprecated property | `EvalResults.scores` | A14 |
| `EvalResults.sample_reductions` | deprecated property | `EvalLog.reductions` | A14 |
| `EvalSample.score` | deprecated 的单 scorer 读取面 | `EvalSample.scores` | A14、A20 |

`var()` 出现在包的 `__all__` 和固定源码中，却未出现在观察日的生成 API reference 列表。
本文把它视为公开但文档发现性不足的 API，不把网页遗漏解释成弃用。

固定源码与官方正文没有把本节任一 scorer、metric 或 reducer 标为 experimental。
PyPI 的 Beta classifier 属于整个包，不能据此把某个 API 单独叫作实验性；表中的 deprecated 项则按源码逐项标出。

## 6. 四个可抄完整场景

以下文件都只依赖 0.3.254 的公开 import。
命令中的模型名沿用官方文档的 `provider/model` 形式；先按第 3 节配置对应 API key。

### 6.1 确定性最终答案检查

保存为 `deterministic_eval.py`：

```python
from inspect_ai import Task, task
from inspect_ai.dataset import Sample
from inspect_ai.scorer import pattern
from inspect_ai.solver import generate


@task
def deterministic_eval() -> Task:
    return Task(
        dataset=[
            Sample(
                input=(
                    "What is the capital of France? "
                    "End with a separate line in the form FINAL: city."
                ),
                target="Paris",
            ),
            Sample(
                input=(
                    "What is the capital of Japan? "
                    "End with a separate line in the form FINAL: city."
                ),
                target=["Tokyo", "Tokyo Metropolis"],
            ),
        ],
        solver=generate(),
        scorer=pattern(r"(?m)^FINAL:\s*(.+?)\s*$", ignore_case=True),
    )
```

```bash
inspect eval deterministic_eval.py --model openai/gpt-5
```

regex 没出现时是 N，出现但城市不在 Target 时是 I，匹配时是 C。
Score.answer 是捕获内容，explanation 保留完整 completion；该形状来自官方 `pattern()` 与 `answer()` 用法，见 A7。

### 6.2 开放 rubric 的独立 Judge

保存为 `judge_eval.py`：

```python
import os

from inspect_ai import Task, task
from inspect_ai.dataset import Sample
from inspect_ai.scorer import model_graded_qa
from inspect_ai.solver import generate


@task
def judge_eval() -> Task:
    grader = os.environ.get("GRADER_MODEL", "openai/gpt-5")
    return Task(
        dataset=[
            Sample(
                input=(
                    "Explain why seasons occur. "
                    "Use no more than four sentences."
                ),
                target=(
                    "The answer must identify Earth's axial tilt as the main cause, "
                    "must connect tilt to changing sunlight angle or day length, "
                    "and must not claim that Earth-Sun distance causes the seasons."
                ),
            ),
        ],
        solver=generate(),
        scorer=model_graded_qa(
            model=grader,
            partial_credit=True,
            include_history=False,
        ),
    )
```

```bash
GRADER_MODEL=openai/gpt-5 inspect eval judge_eval.py --model openai/gpt-5-mini
```

生产实验应让 `GRADER_MODEL` 与被评模型按设计分离，并把两者固定在实验配置中。
regex 抽取成功会得到 C、P 或 I；格式不合约时是带 `grade_parse_failure` 的无分，不会静默算错，见 A8。

Viewer 的 Score metadata 可展开实际裁判 prompt 与回复。
若数据含秘密，不要开启 `include_history`，并在共享 log 前检查 `metadata["grading"]`。

### 6.3 多个判分器投票成一个 Score

保存为 `vote_eval.py`：

```python
from inspect_ai import Task, task
from inspect_ai.dataset import Sample
from inspect_ai.scorer import includes, match, multi_scorer
from inspect_ai.solver import generate


@task
def vote_eval() -> Task:
    return Task(
        dataset=[
            Sample(
                input="Answer with the city only: capital of France?",
                target="Paris",
            ),
        ],
        solver=generate(),
        scorer=multi_scorer(
            scorers=[
                match(location="exact"),
                match(location="end"),
                includes(),
            ],
            reducer="mode",
        ),
    )
```

```bash
inspect eval vote_eval.py --model openai/gpt-5
```

三个子 scorer 并行，众数成为唯一 Score。
这适合只关心最终票决的场景；若需要逐项诊断，应改成 `scorer=[...]`，因为 `multi_scorer()` 不保存每张子票，见 A9。

### 6.4 复合检查、按 key metric 与跨 epoch reducer

保存为 `contract_eval.py`：

```python
from inspect_ai import Epochs, Task, task
from inspect_ai.dataset import Sample
from inspect_ai.scorer import (
    CORRECT,
    INCORRECT,
    Score,
    Scorer,
    Target,
    accuracy,
    scorer,
    stderr,
)
from inspect_ai.solver import TaskState, generate


@scorer(metrics={"*": [accuracy(), stderr()]})
def answer_contract(max_words: int = 4) -> Scorer:
    async def score(state: TaskState, target: Target) -> Score:
        answer = state.output.completion.strip()
        return Score(
            value={
                "target_exact": (
                    CORRECT
                    if answer.casefold() == target.text.casefold()
                    else INCORRECT
                ),
                "concise": (
                    CORRECT if len(answer.split()) <= max_words else INCORRECT
                ),
            },
            answer=answer,
            explanation=f"word_count={len(answer.split())}",
        )

    return score


@task
def contract_eval() -> Task:
    return Task(
        dataset=[
            Sample(
                input="Answer with the city only: capital of France?",
                target="Paris",
            ),
        ],
        solver=generate(),
        scorer=answer_contract(max_words=4),
        epochs=Epochs(3, ["mode", "pass_at_2", "pass_k_2"]),
    )
```

```bash
inspect eval contract_eval.py --model openai/gpt-5
```

结果含 `target_exact` 与 `concise` 两个 `EvalScore`，并为三个 reducer 分别算 accuracy 与 stderr。
`pass_at_2` 问“抽两次至少一次成功”，`pass_k_2` 问“抽两次都成功”；两者不是同一稳定性指标，见 A11。

这个示例也说明 Score.value 的 dict 是一次 scorer 调用中的多个命名判断。
它不同于 Task scorer 列表，也不同于 `multi_scorer()` 的投票。

## 7. 结果、诊断、artifact、CI 与再次判分

### 7.1 结果 schema

| 层 | 关键字段 | 作者能回答的问题 | 材料 |
|---|---|---|---|
| `EvalLog` | `status`、`eval`、`plan`、`results`、`stats`、`error`、`samples`、`reductions` | 本次运行是否完整；配置、用量和整体结果是什么 | A14 |
| `EvalSample` | `id`、`epoch`、`input`、`target`、`messages`、`output`、`scores`、`metadata`、`store`、`events`、`error` | 某一题怎样运行和判分 | A14 |
| `EvalResults` | `total_samples`、`completed_samples`、`early_stopping`、`scores`、`metadata` | 多少项完成；哪些聚合视图存在 | A14 |
| `EvalScore` | `name`、`scorer`、`reducer`、`scored_samples`、`unscored_samples`、`params`、`metrics`、`metadata` | 某 scorer／key／reducer 有多少有效值及哪些 metric | A14 |
| `EvalMetric` | `name`、`group`、`value`、`params`、`metadata` | 一个最终数值怎样命名和配置 | A14 |
| `EvalSampleReductions` | `scorer`、`reducer`、`samples` | 多 epoch 合并后的逐题值 | A14 |

`EvalScore.name` 对 scalar Score 通常是 scorer 名；dict Score 展开后是 dict key。
多个同名 scorer 或 metric 会得到唯一后缀，所以消费方应先检查一次真实 log，而不是硬猜重复名，见 A14 的结果计算源码。

### 7.2 诊断与 artifact 边界

`inspect view` 可按 sample 展开 Messages、Events、判分详情、answer、explanation 与 metadata。
多个 epoch 还能并排比较，适合定位工具调用失败、裁判分歧与提取错误，见 A17。

最终 `ScoreEvent` 还带 target、scorer 名、factory 参数、model usage 与 role usage。
运行中 `scorer.score()` 写的事件另有 `intermediate=True`，可与最终判分区分，见 A2 的 `_score.py` 与 [scorer runner](https://github.com/UKGovernmentBEIS/inspect_ai/blob/2a08d6316db1ea7e0b37cededc6bc571fdeec6d5/src/inspect_ai/_eval/task/run.py)。

Scorer 没有专用 artifact 类或 artifact 路径字段。
小型结构化证据应放 `Score.metadata`，人读摘要放 `explanation`，提取值放 `answer`；大段消息、模型调用与工具事件由 EvalLog 承载。

`.eval` 会把重复的大文本与媒体按 hash 放入 attachments。
读取事件或 base64 媒体时，可用 `read_eval_log(..., resolve_attachments=True)` 或 `resolve_sample_attachments(sample)`，见 [Attachments](https://inspect.aisi.org.uk/eval-logs.html#attachments)。

attachments 是 log 的去重存储机制，不是 scorer 作者的通用 artifact 发布 API。
需要外部文件证据时，作者必须自行定义保存位置、访问权限和 Score metadata 引用，并避免把秘密塞入共享 log。

CI 可把 `.eval` 整体作为受限 artifact 保存，因为门槛数值与逐题诊断都在其中。
它也可能含完整 prompt、工具参数、媒体和 grader 对话，不应当作无敏感信息的公开报告。

### 7.3 一个真实 CI 门槛

普通 `inspect eval` 在 Task 得到 error status 时仍按命令正常结束；单次 Task 状态要从 log 读取。
固定 CLI 实现也明确让非 eval-set 路径返回成功，见 [`_cli/eval.py`](https://github.com/UKGovernmentBEIS/inspect_ai/blob/2a08d6316db1ea7e0b37cededc6bc571fdeec6d5/src/inspect_ai/_cli/eval.py)。

`inspect eval-set` 的退出码反映所有 Task 是否完成成功，但仍不按 accuracy 门槛失败。
因此 CI 应分两步：先运行，再以 log schema 检查 status、无分数和业务 metric。

保存为 `check_eval.py`：

```python
import math
import sys

from inspect_ai.log import read_eval_log


log = read_eval_log(sys.argv[1], header_only=True)
if log.status != "success":
    raise SystemExit(f"eval status is {log.status!r}")
if log.results is None:
    raise SystemExit("eval has no results")
if log.results.completed_samples != log.results.total_samples:
    raise SystemExit(
        f"incomplete samples: "
        f"{log.results.completed_samples}/{log.results.total_samples}"
    )

result = next(
    (item for item in log.results.scores if item.name == "pattern"),
    None,
)
if result is None:
    raise SystemExit("pattern score was not found")
if (result.unscored_samples or 0) != 0:
    raise SystemExit(f"unscored samples: {result.unscored_samples}")
if result.scored_samples != log.results.total_samples:
    raise SystemExit(
        f"scored samples: {result.scored_samples}/{log.results.total_samples}"
    )

accuracy = result.metrics["accuracy"].value
if not math.isfinite(accuracy) or accuracy < 0.90:
    raise SystemExit(f"accuracy below 0.90: {accuracy}")
```

```bash
inspect eval deterministic_eval.py --model openai/gpt-5 --log-dir ci-logs
python check_eval.py "$(inspect log list --json --log-dir ci-logs | python -c '
import json, sys
items = json.load(sys.stdin)
print(items[0]["name"])
')"
```

上面的 shell 取 log 名方式依赖 `inspect log list --json` 的输出 schema。
更稳的流水线可在 Python 中调用 `eval()`，直接使用它返回的 `list[EvalLog]`，并对每个 log 执行同一门槛。

此例只有一个 epoch，所以 `scored_samples` 应等于 `total_samples`。
多 epoch 或有意 early stopping 的 Task 应按 reducer 视图和跳过政策计算自己的期望数，不能照搬这个等式。

### 7.4 延后与离线再次判分

CLI 的完整主线见 A13：

```bash
inspect eval task.py --model openai/gpt-5 --no-score
inspect score ./logs/run.eval
inspect score ./logs/run.eval --scorer match -S location=exact
inspect score ./logs/run.eval --scorer custom.py@my_scorer --action append
inspect score ./logs/run.eval --scorer custom.py@my_scorer --action overwrite
```

`inspect score` 默认另写带 `-scored` 后缀的 log；`--overwrite` 才改原文件。
再次判分已有分数时，score action 默认 `append`；同名结果会加数字后缀，`overwrite` 则替换旧 scores 与 scorer events。

Python 有两个顶层入口；不要与 `inspect_ai.scorer.score()` 混淆：

```text
Scorers = Scorer | Scanner[Transcript] | Sequence[Scorer | Scanner[Transcript]]
Metrics = list[Metric | dict[str, list[Metric]]] | dict[str, list[Metric]]

inspect_ai.score(
    log: EvalLog,
    scorers: Scorers,
    metrics: Metrics | None = None,
    epochs_reducer: ScoreReducers | None = None,
    model: str | Model | None = None,
    model_roles: dict[str, str | Model] | None = None,
    action: Literal["append", "overwrite"] | None = None,
    display: DisplayType | None = None,
    copy: bool = True,
) -> EvalLog

await inspect_ai.score_async(
    log: EvalLog,
    scorers: Scorers,
    metrics: Metrics | None = None,
    epochs_reducer: ScoreReducers | None = None,
    model: str | Model | None = None,
    model_roles: dict[str, str | Model] | None = None,
    action: Literal["append", "overwrite"] | None = None,
    display: DisplayType | None = None,
    copy: bool = True,
    samples: Callable[[int], AsyncContextManager[EvalSample]] | None = None,
) -> EvalLog
```

`action=None` 会变成 `append`；`copy=True` 深拷贝传入 log。
`score_async(..., samples=...)` 可流式提供 sample；同步入口没有这个参数，见 A13。

再次判分会恢复 input、target、messages、output、metadata、store、events、timelines 与 attachments。
它不会重新跑 solver；依赖当时外部 Sandbox 活状态、未写入 log 的文件或瞬态服务的 scorer，不能指望离线重现。

### 7.5 人工改分与 metric 重算

```text
edit_score(
    log: EvalLog,
    sample_id: int | str,
    score_name: str,
    edit: ScoreEdit,
    recompute_metrics: bool = True,
    epoch: int | None = None,
) -> None

recompute_metrics(log: EvalLog) -> None
```

```python
from inspect_ai import edit_score
from inspect_ai.log import ProvenanceData, read_eval_log, write_eval_log
from inspect_ai.scorer import ScoreEdit

log = read_eval_log("./logs/run.eval")
edit_score(
    log=log,
    sample_id="question-7",
    score_name="model_graded_qa",
    edit=ScoreEdit(
        value="C",
        explanation="Reviewed against the published rubric.",
        provenance=ProvenanceData(
            author="reviewer@example.com",
            reason="grader parse failure",
        ),
    ),
    recompute_metrics=True,
    epoch=1,
)
write_eval_log(log, "./logs/run-reviewed.eval")
```

`edit_score()` 原地改内存对象；它不会自动写文件。
多 epoch 下若同一 sample id 有多项，必须给 `epoch`；新增 score 时 `ScoreEdit.value` 不能是 `UNCHANGED`，见 A15。

`recompute_metrics(log)` 可单独重算聚合结果。
它从 log header 重建 scorer、metric 与 reducer 定义；自定义注册项若已不可导入，会影响重算能力，见 A15。

## 8. 自定义扩展

### 8.1 自定义 scorer 的最小模板

```python
from inspect_ai.scorer import (
    CORRECT,
    INCORRECT,
    Score,
    Scorer,
    Target,
    accuracy,
    scorer,
    stderr,
)
from inspect_ai.solver import TaskState


@scorer(metrics=[accuracy(), stderr()])
def contains_all(required: list[str]) -> Scorer:
    async def score(state: TaskState, target: Target) -> Score:
        answer = state.output.completion
        missing = [term for term in required if term.casefold() not in answer.casefold()]
        return Score(
            value=CORRECT if not missing else INCORRECT,
            answer=answer,
            explanation=("all required terms found" if not missing else "missing terms"),
            metadata={"required": required, "missing": missing},
        )

    return score
```

factory 参数会进入 scorer spec，便于 log 展示与再次创建。
应使用可序列化、可稳定重建的参数；把已打开连接或匿名运行态对象藏进 closure，会削弱离线再次判分。

需要返回 `None` 时，应把语义写清为“此 scorer 不适用于该样本”。
若适用但证据不足，返回 `Score.unscored(explanation=..., metadata=...)`，让结果保留无分计数。

### 8.2 自定义 metric

```python
import math

from inspect_ai.scorer import Metric, NOANSWER, SampleScore, metric


@metric(scores="unreduced")
def refusal_rate() -> Metric:
    def compute(scores: list[SampleScore]) -> float:
        if not scores:
            return math.nan
        refused = sum(item.score.as_str() == NOANSWER for item in scores)
        return refused / len(scores)

    return compute
```

这里显式选择 `unreduced`，所以每个 epoch 是一次观察。
若想按 sample 合并后计算，应使用 `scores="reduced"` 并保证 Task 配了 reducer；默认 `auto` 保留旧行为，见 A4。

自定义 metric 需要 Sample metadata 时，可读 `SampleScore.sample_metadata` 或调用 `sample_metadata_as()`。
它不应发模型请求；模型判定应先做成 async scorer，再由 metric 汇总数值。

### 8.3 自定义 reducer

```python
import math

from inspect_ai.scorer import (
    CORRECT,
    INCORRECT,
    Score,
    ScoreReducer,
    score_reducer,
)


@score_reducer(name="all_correct")
def all_correct() -> ScoreReducer:
    def reduce(scores: list[Score]) -> Score:
        usable = [
            item
            for item in scores
            if not (isinstance(item.value, float) and math.isnan(item.value))
        ]
        if not usable:
            return Score.unscored(explanation="no scored epochs")
        passed = all(item.as_str() == CORRECT for item in usable)
        return Score(
            value=CORRECT if passed else INCORRECT,
            metadata={"scored_epochs": len(usable)},
        )

    return reduce
```

注册后可写 `Epochs(3, "all_correct")`。
这个示例只接受 scalar C／I verdict；传入 list 或 dict 会由 `as_str()` 拒绝。
自定义 reducer 必须自己决定无分、容器 shape、answer、explanation 与 metadata 的保留规则；protocol 不替作者决定这些政策。

### 8.4 扩展裁判与安全约束

优先把 rubric 放进 `Sample.target`，把裁判行为放进具名 scorer factory 参数。
这样 log 同时保留 criterion、factory 参数、裁判 prompt、回复与最终 Score，便于再次判分。

若内置 model grader 不足，可写 async scorer 并显式调用 `get_model()`。
仍应采用数据边界、固定输出 schema、失败即无分、最小上下文、秘密分级和完整诊断；不要把 regex 抽取失败转成 I。

依赖网络、Sandbox 或文件系统的 scorer 应把必要证据先写进 Score 或 EvalLog 可恢复字段。
否则在线成功只证明当时状态，`inspect score` 不能在日后复现同一判断。

## 9. 好在哪里

以下均为研究判断。

### 9.1 一次判分有可读的结构

`Score(value=..., answer=..., explanation=..., metadata=...)` 把机器值、人读理由和诊断数据放在同一个返回对象。
作者不必以异常文本代替失败详情，Viewer 也能按统一字段展示。

`ScoreEdit` 与 `history` 继续沿用同一结构。
人工复核不是另建一套旁路数据，而是在同一 Score 上留下旧值、修改值和 provenance。

### 9.2 语法把单样本判定与实验统计分开

`@scorer(metrics=[accuracy(), stderr()])` 很短，却明确绑定两个不同阶段。
async scorer 可访问模型和工具状态，sync metric 只处理 `SampleScore`；作者能看出成本和生命周期差异。

dict Score 配 `metrics={"*": [...]}` 也很实用。
一次昂贵判断可返回多个命名分量，而不必重复读取模型输出或重复请求 Judge。

### 9.3 多次运行的统计问题有具名工具

`Epochs(5, ["mode", "pass_at_2", "pass_k_2"])` 直接表达稳定性问题。
它比先把五次结果压成一个平均数更诚实，因为“至少一次成功”和“每次都成功”会同时保留。

`frequency()` 明示使用 unreduced view，也避免 category 分布被 mode 先抹平。
这种 metric 自报 epoch 视图的做法，具体解决了聚合顺序歧义。

### 9.4 再次判分是一等工作流

`--no-score`、`inspect score`、`action="append"` 与 `action="overwrite"` 让 scorer 开发不必重复付生成成本。
恢复的 TaskState 含消息、输出、Store、events 与 timelines，能支持比纯 completion 更丰富的离线 Judge。

append 还能把多个 grader 的分数并排放进同一 log。
这比替换旧值后另写外部表格更利于追查 scorer 变化。

### 9.5 裁判失败没有被伪装成错误答案

默认 grader regex 失配返回 `Score.unscored()`，并保存裁判回复和 `grade_parse_failure`。
这个细节避免格式漂移把模型能力指标向 0 拉低，也给重试或人工复核留下明确入口。

默认 regex 取最后一个 verdict，数据 marker 也会被中和。
这不是完整的 prompt 注入防御，但它处理了两个可复现的常见失败面。

## 10. 不好的地方与不应类比 NiceEval 的边界

### 10.1 API 与语义上的代价

以下为研究判断；事实依据仍是第 5 节的固定源码。

- `Value` 同时容纳字符串、数字、bool、list 与 dict，灵活但缺少具名 verdict 类型。
  拼错的 category 可能被 `value_to_float()` warning 后算成 0，容易把配置错误伪装成低分。

- 无分使用根级 float `NaN`，跳过使用 Python `None`。
  两者在类型上都不醒目，dict 分量中的 `None` 又有第三种含义，作者必须记住位置相关规则。

- `Target.text` 直接拼接多个字符串，没有分隔符。
  接受多个答案时应迭代 Target；把它误作完整 rubric 文本可能得到意外内容。

- `Task(scorer=[...])`、dict Score 与 `multi_scorer()` 都可表达“多个判断”，但保存方式和执行次序不同。
  API 名没有在类型层强迫作者选择“独立结果、共享计算或投票”。

- `multi_scorer()` 只保留 reducer 的结果。
  裁判分歧和每张子票不会自动进入 metadata，诊断质量取决于自定义 reducer。

- `model_graded_*` 的多模型列表复用这个行为。
  它能给多数票，却不会自动保存完整 Judge panel；首项 grading metadata 也不能代表每位 Judge 的证据。

- 内置 reducer 在合并后总取第一项 metadata。
  answer 与 explanation 会检查一致性，metadata 却不检查；跨 epoch 证据可能被误读成总体证据。

- grader 的默认模型路由会从 `model` 回到 `model_role`，再回到被评模型。
  忘记绑定角色不会报错，却可能让被评模型给自己判分。

- 内置安全措施只中和一组结构 marker。
  自定义 template、instructions、metadata 语义和长对话仍可受不可信内容影响。

- Inspect 没有“metric 低于阈值就失败”的 Task 契约。
  `fail_on_error` 只管运行异常，普通 `inspect eval` 的退出码也不表达 Task status；CI 需要额外脚本。

- API reference 与导出清单有轻微漂移，例如公开 `var()` 未出现在生成页面。
  对 beta 包，作者需要同时查 reference、changelog 与固定源码。

### 10.2 不应把它叫作 NiceEval assertion 的同义物

Inspect scorer 接收整个 `TaskState` 和 `Target`，返回实验 Score。
它没有 `expect(actual).to...` 式 receiver，也没有围绕一次 tool call、turn 或 Run 的具名 assertion 对象。

I 或 0 是正常数据，不是失败异常。
Metric 面向一批样本做统计，不负责向测试 runner 报 assertion failure；二者的消费协议不同。

`TaskState` 是广域执行状态。
从 `messages`、`store` 或 Sandbox 找证据属于 scorer 作者的自由代码，不等于 NiceEval 已定义了稳定、可发现的证据选择器。

Inspect Scout scanner 更接近稀疏异常发现，但它是另一个产品的 transcript API。
把 scanner 传给 scorer 槽位，也不会自动变成 NiceEval 的 assertion catalog 或诊断契约。

因此可类比的是“判断结果如何结构化、汇总和复核”。
不应类比的是 receiver 语法、失败传播、证据类型、Run 生命周期与 assertion 的产品边界。

## 11. 对 NiceEval 可吸收与不应复制

以下是面向 NiceEval 的研究建议，不是 Inspect 官方事实，也不是已定 NiceEval 契约。

| 可吸收的设计 | 为什么有用 | 建议变体 |
|---|---|---|
| 判定对象同时带值、实际答案、解释和 metadata | 一次 API 同时服务机器门槛与人工诊断 | 使用具名字段，并约束 metadata 可序列化与秘密等级 |
| async 单项判定与批量 metric 分层 | 把模型／Sandbox I/O 与纯统计分开 | 在类型名中明确 sample、Run、turn 这类 receiver |
| 无分仍保留解释和证据 | 不把裁判故障算成错误答案 | 用 tagged union 表达 `scored/unscored/skipped/error`，不要用 `NaN`／`None` |
| scorer factory 参数进入 log | 能知道某个结果由什么配置产生 | 同时保存实现 version、内容 hash 与外部 Judge 标识 |
| 延后与 append 式再次判分 | scorer 迭代不重复生成，多个 Judge 可并排比较 | 让再次判分声明所需证据，并在证据缺失时给结构化失败 |
| dict key 对应独立 metric | 一次昂贵检查可给多项判断 | 把 key 定义成 schema，避免运行时 glob 才发现不一致 |
| epoch reducer 与 unreduced metric | 明示聚合次序，保留稳定性信号 | 给“同题多次”和“多 Judge 投票”不同类型，不共用无标签 reducer |
| Score edit history 与 provenance | 人工复核和 grader 修正可追查 | 把修改者、原因、时间和原始证据设为必需政策字段 |

| 不应复制的设计 | 风险 | NiceEval 更合适的方向 |
|---|---|---|
| `C/I/P/N` 普通字符串加宽松数值转换 | typo 与未知 category 可能静默变成 0 | 封闭 verdict enum；未知值直接配置错误 |
| 根级 `NaN` 表达无分 | 序列化、比较与容器位置语义隐晦 | 显式 union，不让 metric 猜 sentinel |
| `None` 同时承担“不返回结果” | 与无分、过滤条件相邻却不同 | 具名 `skip(reason)`，并单列计数 |
| grader 角色未绑定时回到被评模型 | 关键独立性约束可能静默失效 | 要求显式 Judge，或把自评降级写成醒目诊断 |
| `Target.text` 无分隔拼接 | 多答案与 rubric 容易混用 | 区分 `expectedAnswers`、`rubric` 与 reference data |
| reducer 只取第一项 metadata | 聚合值与证据不同步 | reducer 返回聚合证据，或保留每项 child result |
| 普通命令不按结果门槛失败 | CI 成功可能只表示进程完成 | 一等 gate 契约同时检查状态、无分政策与 metric 阈值 |
| 整个 TaskState 作为默认判分输入 | 能力强但发现性与最小权限弱 | 给常见 receiver 窄接口；需要广域状态时显式升级权限 |

最值得吸收的不是某个 scorer 名，而是完整闭环：结构化单项结果、明确聚合视图、可复核证据和低成本再次判分。
最不该复制的是让 sentinel、隐式 fallback 与宽松转换承担契约语义。

## 12. 无法核实项

以下内容没有被本文提升为事实：

- 没有发起付费模型调用，因此四个示例只按 0.3.254 的 import、signature 与官方形状静态核对。
  实际答案、成本、延迟和模型可用名取决于读者账户与观察日后的 Provider 状态。

- 没有对 model grader 做对抗性 prompt 注入实验。
  本文只确认 marker 中和、默认 regex、history 选择和 log 写入机制，不宣称它能抵御任意攻击。

- `prompt_logprobs` 与 `tokenize()` 是否可用取决于具体 Provider。
  固定源码规定了缺失时的行为，但没有给所有 Provider 一致支持保证。

- Inspect Scout 是独立包。
  本文只核对 Inspect AI 官方集成页与 scorer 槽位类型，没有逐项验证 Scout 的 `Result`、scanner catalog 或其版本兼容矩阵。

- rolling 文档可能在 2026-08-09 后改变。
  signature 与语义以 commit `2a08d6316db1ea7e0b37cededc6bc571fdeec6d5` 为观察快照，网页只供阅读。

- deprecated alias 注明在 0.4 移除，但 0.4 的实际发布日期和最终迁移范围未知。
  本文不推测未发布版本。

- 自定义 scorer 若依赖外部文件、活 Sandbox 或未写入 log 的服务状态，离线再次判分能否复现取决于作者自己的保存策略。
  Inspect 的公开契约没有保证重建这些外部状态。
