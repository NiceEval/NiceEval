# Arize Phoenix Evaluation：从 evaluator 到 annotation 与 CI

> 观察日期：2026-08-09。
>
> 本文研究 Arize Phoenix Evaluation 的公开作者面。
> 范围限于断言、evaluator、Judge、grader、metric、判定、组合与聚合。
> Provider 细节、部署、通用 tracing SDK 和权限配置不在盘点范围内。

## 1. 定位与真实边界

Phoenix 把评估分成三层。客户端 evals SDK 负责执行判定逻辑，Phoenix client 负责实验与 annotation，Phoenix 服务端负责持久化和 UI。[EVAL-OVERVIEW]

Python 与 TypeScript 的 evals SDK 可以脱离 Phoenix 服务端运行。单条输入会得到 `Score` 或 `EvaluationResult`，批量与实验适配层再把结果写成 annotation。[P-CORE] [TS-CORE]

服务端还有两种作者入口。LLM evaluator 由 Phoenix Prompt、结构化标签和 Judge 模型组成；code evaluator 在受管 Sandbox 中执行 Python 或 TypeScript。[S-LLM] [S-CODE]

Phoenix 的基础 evaluator 不是断言。它给出可选分数、标签、解释和优化方向，却不自带阈值、`passed` 字段或测试退出码。[P-CORE] [TS-TYPES]

固定快照未导出名为 `Assertion` 或 `Grader` 的 SDK 类型。Python client 的 experiment evaluator 工厂有 `scorer` 参数，但返回对象仍叫 evaluator。[P-CORE] [CLIENT-PY] [TS-TYPES]

测试集成才把判定变成准入条件。pytest 使用普通 `assert`；Vitest/Jest 还提供按平均值或通过率计算的 suite 级 `acceptanceCriteria`。[PYTEST] [JS-TEST]

研究判断：Phoenix 的强项是“算出信号后把它接回 trace、experiment 和 UI”。它不是以断言组合器为中心的测试 DSL，也不是通用任务执行框架。

## 2. 观察版本和一手链接

### 2.1 固定快照

| 对象 | 观察版本 | 固定方式 | 观察事实 |
| --- | --- | --- | --- |
| Python evals | `arize-phoenix-evals==3.4.0` | tag commit `c298db11bb80b92eb29879543552ba9545873fd1` | Python `>=3.10,<3.15`；PyPI 上传于 2026-08-08。[PYPI-EVALS] |
| TypeScript evals | `@arizeai/phoenix-evals@2.2.0` | npm tarball SHA-1 `70828984ebd2fc18fd9d8bf90975f92a2e173dfa` | Node `>=22.12`；发布于 2026-08-03。[NPM-EVALS] |
| Python client | `arize-phoenix-client==2.13.0` | tag commit `78c381f670c5e1aca4ef4b5b3fa8b801ea06ee70` | Python `>=3.10,<3.15`；上传于 2026-07-12。[PYPI-CLIENT] |
| TypeScript client | `@arizeai/phoenix-client@7.3.0` | npm tarball SHA-1 `1fb5868541eb0704d0aacb66272466ef2d790776` | Node `>=18`；发布于 2026-08-07。[NPM-CLIENT] |
| Phoenix server | `19.19.1` | tag commit `aa6d8e16f65ffdf82e822c7f50449e65630c3756` | GitHub Release 发布于 2026-08-08。[SERVER-RELEASE] |
| 仓库观察点 | `b4d9b19e6c681cedcf627fc27dc48f13c7320b73` | 2026-08-09 的 `HEAD` | npm 2.2.0 与 7.3.0 tarball 内的相关 `src/` 与该提交无差异。[REPO] |

TypeScript 包没有与 2.2.0 对应的可验证 Git tag。本文因此以 npm tarball 为发布事实，再用仓库观察点提供可点击源码。

### 2.2 一手材料索引

下列代号会在 API 表附近重复出现。所有链接都是官方仓库、官方文档、官方 API reference 或发布注册表。

| 代号 | 可定位内容 |
| --- | --- |
| `[P-CORE]` | Python `Score`、evaluator 基类、工厂、绑定与 DataFrame 执行源码 |
| `[P-METRICS]` | Python 3.4.0 的全部公开 built-in 导出与各实现 |
| `[P-PROMPT]` | Python `PromptTemplate`、旧 `Template` 与 Prompt 转换 |
| `[P-EXEC]` | Python 执行状态、重试、超时与并发控制 |
| `[P-ANNOTATION]` | Python score 到 annotation DataFrame 的转换 |
| `[TS-CORE]` | TypeScript evaluator、返回值转换和输入映射 |
| `[TS-LLM]` | TypeScript Judge evaluator、模板与全部 LLM built-in |
| `[TS-METRICS]` | TypeScript classification metric 与工厂 |
| `[CLIENT-PY]` | Python spans、traces、annotations 与 experiments |
| `[CLIENT-TS]` | TypeScript experiments、补判与测试接口 |
| `[S-BUILTIN]` | 服务端全部预置 evaluator |
| `[MIGRATION]` | 2026-04 的旧 API 删除说明 |

## 3. 安装、最小项目与首个可运行 eval

### 3.1 Python：不启动 Phoenix 也能运行

```bash
mkdir phoenix-eval-python
cd phoenix-eval-python
python -m venv .venv
source .venv/bin/activate
python -m pip install "arize-phoenix-evals==3.4.0"
```

建立 `main.py`：

```python
from phoenix.evals.metrics import exact_match

scores = exact_match.evaluate(
    {
        "output": "Paris",
        "expected": "Paris",
    }
)

score = scores[0]
print(score.to_dict())
assert score.name == "exact_match"
assert score.score == 1.0
assert score.label is None
```

运行：

```bash
python main.py
```

3.4.0 的源码实际返回 `score=1.0`、`label=None`。官方 Exact Match 页面仍展示布尔标签，不能据此编写断言。[P-METRICS] [EXACT-MATCH]

### 3.2 TypeScript：相同检查要自己创建 evaluator

TypeScript 包没有预置 exact-match。它要求 Node 22.12 以上，并依赖 AI SDK 7；纯 code evaluator 不需要 Judge Provider。[NPM-EVALS] [EXACT-MATCH]

```bash
mkdir phoenix-eval-ts
cd phoenix-eval-ts
npm init -y
npm install @arizeai/phoenix-evals@2.2.0
npm install --save-dev tsx typescript
```

建立 `eval.ts`：

```typescript
import { createEvaluator } from "@arizeai/phoenix-evals";

const exactMatch = createEvaluator<{ output: string; expected: string }>(
  ({ output, expected }) => ({
    score: output === expected ? 1 : 0,
    label: output === expected ? "match" : "mismatch",
  }),
  { name: "exact_match", optimizationDirection: "MAXIMIZE" },
);

const result = await exactMatch.evaluate({ output: "Paris", expected: "Paris" });
console.log(result);
if (result.score !== 1) throw new Error("exact_match failed");
```

```bash
npx tsx eval.ts
```

两段程序都只计算本地结果。若要在 Phoenix UI 中比较多次运行，还要安装对应 client 并连接 Phoenix。[EVAL-OVERVIEW]

## 4. 核心数据流与对象关系

```text
作者输入或实验行
  → input mapping
  → 输入 schema / 模板变量
  → code evaluator 或 LLM Judge
  → Score（Python）/ EvaluationResult（TypeScript）
  → DataFrame、experiment adapter 或测试 adapter
  → span / trace / document / experiment-run annotation
  → Phoenix 比较页与 evaluator trace
```

`input mapping` 的键是 evaluator 想要的字段，值是原始对象的路径或转换函数。映射发生在 evaluator 逻辑之前。[INPUT-MAPPING]

| 层 | Python 对象 | TypeScript 对象 | 责任 |
| --- | --- | --- | --- |
| 单条 evaluator | `Evaluator` | `EvaluatorInterface<RecordType>` | 接收一条对象，执行一次判定 |
| Judge 特化 | `LLMEvaluator`、`ClassificationEvaluator` | `LLMEvaluator`、`ClassificationEvaluator` | 渲染 prompt，要求结构化 label，再映射 score |
| 单次结果 | `Score` | `EvaluationResult` | 携带数值、标签与解释 |
| 批量执行 | `evaluate_dataframe`、`async_evaluate_dataframe` | evals 包没有同类 DataFrame runner | 执行行 × evaluator 笛卡尔积 |
| 数据集聚合 | `PrecisionRecallFScore` | `computePrecisionRecallFScore` 与六个工厂 | 对整组标签计算 precision、recall 与 F-beta |
| Phoenix 存储 | annotation DataFrame、experiment evaluation | annotation 或 experiment evaluation | 把 evaluator 结果关联到被测对象 |
| CI | pytest plugin | Vitest/Jest entrypoint | 把断言或 aggregate 准入条件接到退出码 |

`Score.direction` 与 `optimizationDirection` 只描述“高分更好、低分更好或中性”。它们不比较阈值，也不自动让进程失败。[P-CORE] [TS-TYPES]

## 5. 完整 API catalog

### 5.1 结果、失败、跳过与无分语义

#### Python `Score`

```python
Score(
    *,
    name: str | None = None,
    score: float | int | None = None,
    label: str | None = None,
    explanation: str | None = None,
    metadata: dict | None = None,
    direction: Literal["maximize", "minimize", "neutral"] = "maximize",
    kind: Literal["human", "llm", "heuristic", "code"] | None = None,
)
```

对象是冻结 dataclass。`metadata` 默认空字典；`to_dict()` 排除 `None`；`pretty_print(indent=2)` 打印 JSON。[P-CORE]

`source` 属性和参数已弃用，改用 `kind`。`kind="heuristic"` 也已弃用，运行时会转成 `code`。[P-CORE]

#### TypeScript `EvaluationResult`

```typescript
interface EvaluationResult {
  score?: number;
  label?: string;
  explanation?: string;
}
```

基础 evals 包的结果没有 `metadata`、方向、名称或 kind。这些描述存在 evaluator 对象上；experiment annotation 适配层另有 `metadata`。[TS-TYPES] [CLIENT-TS]

#### 没有一等 `skip` 或 `unscored`

| 情况 | Python 单条 | Python DataFrame | TypeScript 单条 | 服务端 |
| --- | --- | --- | --- | --- |
| 只有 label | 合法，`score=None` | score 字典中无数值 | 合法，省略 `score` | LLM categorical 可由 label 映射数值 |
| 空结果 | 可手写全为 `None` 的 `Score` | 仍是一个 score 对象 | `{}` 合法 | 没有通用空结果契约 |
| 映射失败 | 抛 `ValueError` 或 `TypeError` | 写失败详情，score 为 `None` | 取值函数或后续逻辑抛错 | JSONPath 未命中使本次执行失败 |
| evaluator 抛错 | 原样抛出 | 按重试与停止选项处理 | Promise reject | 形成 evaluator 执行错误 |
| 测试跳过 | 不适用 | 不适用 | 不适用 | pytest/Vitest/Jest 跳过的 case 不写入 |

研究判断：`score=None`、失败和跳过是三种不同状态，但基础结果类型没有判别联合。调用方必须结合异常、execution details 或测试 runner 状态理解它们。

### 5.2 Python 核心 evaluator API

| API | 签名或配置 | 返回与同步性 | 默认值及失败语义 |
| --- | --- | --- | --- |
| `Evaluator(...)` | `name`、`kind` 必填；`direction="maximize"`；`input_schema=None` | 抽象基类 | 子类至少实现 `_evaluate`；基类 async 会把同步实现放到线程池。[P-CORE] |
| `.evaluate(...)` | `(eval_input, input_mapping=None)` | `list[Score]`，同步 | 映射或 Pydantic 校验失败即抛错；每次调用创建 evaluator span。[P-CORE] |
| `.async_evaluate(...)` | 同上 | `Awaitable[list[Score]]` | LLM 子类走原生 async；普通同步子类走线程池。[P-CORE] |
| `.bind(...)` / `.unbind()` | `bind(input_mapping) -> None` | 原对象原地改变 | 调用级 `input_mapping` 优先；`unbind()` 移除固定映射。[P-CORE] |
| `.describe()` | 无参数 | JSON 可序列化字典 | 给出 name、kind、direction 与 Pydantic schema。[P-CORE] |
| `bind_evaluator(...)` | `(evaluator, input_mapping)` | 一个浅复制 evaluator | 映射会深复制；LLM client 仍共享。源码行为与 docstring 的“同一对象”说法不同。[P-CORE] |
| `LLMEvaluator(...)` | `name`、`llm`、`prompt_template` 必填；`schema=None`、`input_schema=None`、`direction="maximize"` | 抽象 Judge 基类 | 未传 schema 时，从模板变量创建全必填 Pydantic schema。[P-CORE] |
| `ClassificationEvaluator(...)` | 再加 `choices`；`include_explanation=True` | 每次同步或 async 返回一个 `Score` | Judge 必须支持 tool calling 或 structured output；未知 label 抛 `ValueError`。[P-CORE] |
| `create_classifier(...)` | `(name, prompt_template, llm, choices, direction="maximize")` | `ClassificationEvaluator` | 位置参数仍能用，但会发弃用警告。[P-CORE] |
| `create_evaluator(...)` | `(name, source=None, direction="maximize", kind=None)` 装饰 sync 或 async 函数 | 一个仍可直接调用的 `Evaluator` | `kind` 默认 `code`；函数签名生成输入 schema。[P-CORE] |
| `evaluate_dataframe(...)` | `(dataframe, evaluators, tqdm_bar_format=None, hide_tqdm_bar=False, exit_on_error=None, max_retries=None)` | 同步返回输入副本 | 实际默认首错停止、最多重试 10 次；停止后仍返回部分结果。[P-CORE] [P-EXEC] |
| `async_evaluate_dataframe(...)` | 再加 `concurrency=None` | async 返回输入副本 | 默认并发 3、每任务 60 秒、最多重试 10 次、首错后停止其余任务。[P-CORE] [P-EXEC] |
| `to_annotation_dataframe(...)` | `(dataframe, score_names=None)` | span annotation DataFrame | 必须有列名或索引名含 `span_id`；空列表也触发自动发现全部 `_score` 列。[P-ANNOTATION] |

#### `create_evaluator` 的全部返回转换

| 用户函数返回 | 生成的 `Score` |
| --- | --- |
| `Score` | 保留 score、label、explanation、metadata；name、kind、direction 改为装饰器配置 |
| `int` / `float` | 写入 `score` |
| `bool` | 写入 `score=1.0/0.0` 与 `label="True"/"False"` |
| 不超过三个空格分词的字符串 | 写入 `label` |
| 四个词以上的字符串 | 写入 `explanation` |
| 字典 | 只读取 `score`、`label`、`explanation`；其中的 `metadata` 会被忽略 |
| tuple | 逐项读取 number、bool、string；后出现的数值会替换前一数值 |
| 其他类型 | 抛 `ValueError` |

异步函数装饰后必须调用 `async_evaluate()` 或直接 `await evaluator(...)`。调用它的同步 `evaluate()` 会抛 `NotImplementedError`。[P-CORE]

#### Python input mapping

映射类型是 `Mapping[evaluator_field, str | callable]`。字符串先尝试顶层同名键，再按 `jsonpath-ng` 路径取值。[P-ANNOTATION] [INPUT-MAPPING]

| callable 形状 | 实参绑定 |
| --- | --- |
| 零参数 | 抛 `ValueError` |
| 一个参数，且原始对象有同名键 | 只把该键的值传入 |
| 一个参数，原始对象没有同名键 | 传入完整原始对象 |
| 多个具名参数 | 从顶层同名键绑定；默认参数照常生效 |

缺失必填字段、无效路径和 Pydantic 类型不符都会失败。映射不是“试着取值后传 `None`”的宽松机制。[P-CORE] [P-ANNOTATION]

#### DataFrame 输出列与执行状态

每个 evaluator 增加 `{evaluator.name}_execution_details`。每个实际 score 名增加 `{score.name}_score`，单元格是字典或 `None`。[P-CORE]

execution status 只有四个值：`DID NOT RUN`、`COMPLETED`、`COMPLETED WITH RETRIES`、`FAILED`。详情还包含异常列表和执行秒数。[P-EXEC]

`exit_on_error=True` 不会重新抛出 evaluator 异常。executor 会停止其余任务，并把尚未执行的格子留作 `DID NOT RUN`。[P-EXEC]

同名 evaluator 会争用 execution-details 列，同名 score 会争用 score 列。后写值可能替换前写值，官方源码注释明确称会丢数据。[P-CORE]

async executor 使用 AIMD 调整实际并发，并以传入 `concurrency` 为上限。超时算入重试次数；非 rate-limit 的 `PhoenixException` 不重试。[P-EXEC]

### 5.3 Python `LLM`、模板与 Judge

```python
LLM(
    *,
    provider: str | None = None,
    model: str | None = None,
    client: str | None = None,
    initial_per_second_request_rate: float | None = None,
    sync_client_kwargs: dict | None = None,
    async_client_kwargs: dict | None = None,
    **kwargs,
)
```

`provider` 与 `model` 必须同时提供。构造器同时建立同步和异步 client，并为官方识别的限流异常装入 rate limiter。[P-LLM]

公开生成方法有同步与 async 成对版本。built-in classifier 使用 object 或 tool schema，不靠自由文本中抓取 label。[P-LLM] [EVAL-OVERVIEW]

| 方法 | 签名 | 返回与默认值 |
| --- | --- | --- |
| `generate_text` | `(prompt, tracer=None, **kwargs)` | 同步返回 `str` |
| `async_generate_text` | 同上 | async 返回 `str` |
| `generate_object` | `(prompt, schema, tracer=None, **kwargs)` | 同步返回符合 JSON Schema 的 `dict` |
| `async_generate_object` | 同上 | async 返回 `dict` |
| `generate_classification` | `(prompt, labels, include_explanation=True, description=None, **kwargs)` | 同步返回含 `label`、可选 `explanation` 的字典 |
| `async_generate_classification` | 同上 | async 返回同形字典 |

`labels` 接受非空字符串数组或 label→description 字典。空标签、结构化输出不符和 Provider SDK 异常会向调用方传播。[P-LLM]

```python
PromptTemplate(
    *,
    template: str | list[dict] | PromptTemplate | Template,
    template_format: TemplateFormat | None = None,
)
```

Python 支持 Mustache `{{name}}` 与 f-string 风格 `{name}`，未指定格式时自动识别。字符串会成为一条 user message；消息列表支持 system、user 与 assistant。[P-PROMPT]

普通变量收到非字符串值时会转成 JSON 文本。Mustache section 与 dotted root 保留 list、dict 或 bool，便于迭代与条件块。[P-PROMPT]

`variables` 给出变量名，`variable_types` 区分 `string` 与 `section`，`render(dict)` 返回消息列表。Mustache 渲染关闭 HTML escaping。[P-PROMPT]

旧 `Template` 只接受字符串，构造即发弃用警告。`phoenix_prompt_to_prompt_template(prompt_version)` 可接 Prompt Management payload 或带 `_dumps()` 的对象。[P-PROMPT]

### 5.4 Python 3.4.0 全部 built-in evaluator

下表以 `phoenix.evals.metrics.__all__` 为穷尽集合，共 14 个导出。前 11 个构造器都是 `(llm: LLM, **kwargs)`。[P-METRICS]

它们可通过 `include_explanation=False` 关闭解释，也可把 temperature 一类调用参数经 `**kwargs` 传给 Judge client。默认解释开启。[P-CORE]

| evaluator | 必填输入 | label → score | direction | 真实边界 |
| --- | --- | --- | --- | --- |
| `ConcisenessEvaluator` | `input`, `output` | `concise` → 1；`verbose` → 0 | maximize | 判断冗长，不判断事实正确性 |
| `CorrectnessEvaluator` | `input`, `output` | `correct` → 1；`incorrect` → 0 | maximize | 不要求 reference 或检索 context |
| `DocumentRelevanceEvaluator` | `input`, `document_text` | `relevant` → 1；`unrelated` → 0 | maximize | 每次判断一个文档文本 |
| `FaithfulnessEvaluator` | `input`, `output`, `context` | `faithful` → 1；`unfaithful` → 0 | maximize | 只按外部 context 检查支持关系 |
| `HallucinationEvaluator` | `input`, `output` | `hallucinated` → 1；`grounded` → 0 | minimize | `input` 是完整会话事实，含既有 tool call/result |
| `RefusalEvaluator` | `input`, `output` | `refused` → 1；`answered` → 0 | neutral | 只识别是否拒答，不判断拒答是否合理 |
| `ToolInvocationEvaluator` | `input`, `available_tools`, `tool_selection` | `correct` → 1；`incorrect` → 0 | maximize | 检查参数、格式与安全，不只看工具名 |
| `ToolSelectionEvaluator` | 同上 | `correct` → 1；`incorrect` → 0 | maximize | 检查选了哪个工具，不检查执行结果 |
| `ToolResponseHandlingEvaluator` | `input`, `tool_call`, `tool_result`, `output` | `correct` → 1；`incorrect` → 0 | maximize | 检查 agent 如何使用成功或失败的工具结果 |
| `ToxicityEvaluator` | `text` | `toxic` → 1；`non-toxic` → 0 | minimize | 可映射用户输入或模型输出 |
| `UserFrictionEvaluator` | `conversation`, `user_message` | `friction` → 1；`no_friction` → 0 | minimize | `no_friction` 不代表满意，也不从沉默推断不满 |

3.4.0 新的 Hallucination 以完整会话为真值；Faithfulness 以显式 `context` 为真值。两者不能互换。[P-METRICS]

Python code built-in 如下：[P-METRICS]

| API | 签名 | 返回、默认值与失败 |
| --- | --- | --- |
| `exact_match` | evaluator 输入 `output: str, expected: str` | Python 严格相等；一个 score 1/0；无 label 与解释；maximize |
| `MatchesRegex` | `(pattern: str | Pattern, name=None, include_explanation=True)`；输入 `output` | 用 `re.findall`，有任一命中即 1；默认解释命中数；无 label；无效 regex 在构造时失败 |
| `PrecisionRecallFScore` | `(*, beta=1.0, average="macro", zero_division=0.0, positive_label=None)` | 输入等长非空 `expected`、`output` 标签数组；返回 precision、recall、F-beta 三个 `Score` |

`PrecisionRecallFScore` 支持 `macro`、`micro`、`weighted`。显式 `positive_label` 时做 one-vs-rest；默认 macro 且标签恰为数值 `{0,1}` 时自动把 1 当正类。[P-METRICS]

`beta<=0`、未知 average、空数组、长度不同或正类不存在都会抛 `ValueError`。该 evaluator 面向整组标签，不是逐行分类器。[P-METRICS]

#### 旧 1.x 页面

官方导航仍保留五个 Legacy 页面：Q&A on Retrieved Data、Retrieval RAG Relevance、Summarization、SQL Generation、Agent Function Calling。[LEGACY-INDEX]

它们不是 3.4.0 的 built-in import。官方迁移说明称 3.0.0 已删除整个 `legacy/` 子包，应把旧 prompt 改写成自定义 `ClassificationEvaluator`。[MIGRATION]

Toxicity 的 `llms.txt` 摘要仍写 Legacy，但正文与 3.4.0 导出都把它列为当前 evaluator。本文采用发布源码与正文，不采用导航摘要。[TOXICITY] [P-METRICS]

### 5.5 TypeScript 核心 API

| API | 签名或配置 | 返回与默认值 | 失败或空结果 |
| --- | --- | --- | --- |
| `createEvaluator(fn, options?)` | options：`name?`、`kind?`、`optimizationDirection?`、`telemetry?` | evaluator；名称依次取配置、函数名、随机名；默认 CODE、MAXIMIZE、telemetry 开启 | 不支持的返回类型变成 `{}`。[TS-CORE] |
| `.evaluate(record)` | 只有对象参数 | 一律 `Promise<EvaluationResult>` | 用户函数抛错或 reject 会向外传播。[TS-CORE] |
| `.bindInputMapping(mapping)` | evaluator 方法 | 返回新 evaluator | 原 evaluator 不变。[TS-CORE] |
| `bindEvaluator(evaluator, {inputMapping})` | 顶层函数 | 返回带映射的新 evaluator | 路径取值失败会传入 `undefined`，再由逻辑或 Judge 报错。[TS-CORE] |
| `toEvaluationResult(value)` | 顶层函数 | 规范化任意值 | `null`、`undefined`、bool 与其他类型得到 `{}`。[TS-CORE] |
| `asEvaluatorFn(fn)` | 顶层函数 | async evaluator function | 先调用 `fn`，再调用 `toEvaluationResult`。[TS-CORE] |
| `LLMEvaluator<RecordType>` | 抽象类；`name` 必填；可配方向、映射与 telemetry | kind 固定 LLM | 子类仍须实现 `evaluate` 与 `bindInputMapping`。[TS-LLM] |
| `ClassificationEvaluator(args)` | `name`、`model`、`choices`、`promptTemplate` 必填 | 可直接 `new`；Judge 总是 async | 空 choices 失败；方向未传时为 `undefined`。[TS-LLM] |
| `createClassificationEvaluator(args)` | 与类构造器相同 | `ClassificationEvaluator` | 空 choices 失败；Judge 生成 label 与 explanation。[TS-LLM] |
| `createClassifierFn(args)` | `model`、`choices`、`promptTemplate` 必填；可配 telemetry | `(record) => Promise<EvaluationResult>` | 没有 evaluator 名称或方向；空 choices 失败。[TS-LLM] |
| `generateClassification(args)` | `model`、非空 `labels` 与 AI SDK prompt 必填；可配 schema 名、说明与 telemetry | `Promise<{label, explanation}>` | AI SDK structured object 失败会 reject。[TS-LLM] |
| `formatTemplate({template, variables})` | string 或 AI SDK `ModelMessage[]` | 渲染后的同类 prompt | 只用 Mustache；关闭 HTML escaping。[TS-LLM] |
| `getTemplateVariables({template})` | 同上 | `string[]` | 只收集普通 Mustache name token。[TS-LLM] |

`createEvaluator` 的转换集合是穷尽的：number → score；string → label；对象只取数值 score、字符串 label、字符串 explanation；其余得到空对象。[TS-CORE]

这与 Python 明显不同。TypeScript 的 `true` 不会变成 1；作者必须显式返回 `1`、`0` 或完整对象。[TS-CORE]

TypeScript 映射值可为简单键、dot path、数组索引、JSONPath 或 `(record) => value`。映射后的字段会增加或替换同名字段，原字段仍保留。[TS-CORE]

### 5.6 TypeScript 2.2.0 全部 LLM built-in

全部工厂使用同一配置形状：[TS-LLM]

```typescript
createXEvaluator({
  model,
  name?,
  choices?,
  promptTemplate?,
  optimizationDirection?,
  inputMapping?,
  telemetry?,
})
```

`model` 是 AI SDK 7 的 `LanguageModel`。工厂返回 `ClassificationEvaluator`，调用总是 async；内置 choices、模板、名称与方向都能替换。[TS-LLM]

| 工厂 | `RecordType` 必填字段 | 默认 label → score | 默认方向 |
| --- | --- | --- | --- |
| `createConcisenessEvaluator` | `input`, `output` | concise → 1；verbose → 0 | MAXIMIZE |
| `createCorrectnessEvaluator` | `input`, `output` | correct → 1；incorrect → 0 | MAXIMIZE |
| `createDocumentRelevanceEvaluator` | `input`, `documentText` | relevant → 1；unrelated → 0 | MAXIMIZE |
| `createFaithfulnessEvaluator` | `input`, `output`, `context?` | faithful → 1；unfaithful → 0 | MAXIMIZE |
| `createHallucinationEvaluator` | `input`, `output` | hallucinated → 1；grounded → 0 | MINIMIZE |
| `createRefusalEvaluator` | `input`, `output` | refused → 1；answered → 0 | NEUTRAL |
| `createToolInvocationEvaluator` | `input`, `availableTools`, `toolSelection` | correct → 1；incorrect → 0 | MAXIMIZE |
| `createToolSelectionEvaluator` | 同上 | correct → 1；incorrect → 0 | MAXIMIZE |
| `createToolResponseHandlingEvaluator` | `input`, `toolCall`, `toolResult`, `output` | correct → 1；incorrect → 0 | MAXIMIZE |
| `createToxicityEvaluator` | `text` | toxic → 1；non-toxic → 0 | MINIMIZE |
| `createUserFrictionEvaluator` | `conversation`, `userMessage` | friction → 1；no_friction → 0 | MINIMIZE |

TypeScript 使用 camelCase，Python 使用 snake_case。2.2.0 的 Hallucination 同样以 conversation grounding 为准。[TS-LLM] [NPM-EVALS]

### 5.7 TypeScript 全部 classification metric API

```typescript
interface PrecisionRecallFScoreOptions {
  beta?: number;                 // 1
  average?: "macro" | "micro" | "weighted"; // "macro"
  zeroDivision?: number;         // 0
  positiveLabel?: string | number;
}
```

| API | 返回 |
| --- | --- |
| `computePrecisionRecallFScore(example, options={})` | 同步返回 precision、recall、fScore、beta、average、labels、positiveLabel |
| `createPrecisionEvaluator(options={})` | 名为 `precision{suffix}` 的 CODE evaluator |
| `createRecallEvaluator(options={})` | 名为 `recall{suffix}` 的 CODE evaluator |
| `createFBetaEvaluator(options={})` | 名为 `f{beta}{suffix}` 的 CODE evaluator |
| `createF1Evaluator(options={})` | 固定 beta 1 的 F1 evaluator |
| `createPrecisionRecallFScoreEvaluators(options={})` | `{precision, recall, fScore}` 三个 evaluator |

每个 evaluator 接收 `{expected: Array<string|number>, output: Array<string|number>}`，并返回 `Promise<{score}>`。它们都是整组标签 metric。[TS-METRICS]

三联工厂会在三个 evaluator 收到同一个对象引用时复用一次计算。传入三个新对象就没有这项复用。[TS-METRICS]

默认值、自动正类规则与 Python 相同。无效 beta、average、空数组、长度不同或正类不存在都会抛 `Error`。[TS-METRICS]

### 5.8 服务端 built-in 与作者配置

服务端 evaluator 绑定到 dataset，在 Playground experiment 运行时自动执行。输入上下文固定为 `input`、`output`、`reference`、`metadata`。[S-BUILTIN] [S-INPUT]

每个参数可选择 Path 或 Literal。未配置时按顶层同名键绑定；路径未命中会让本次执行失败。[S-INPUT]

#### 五个 code built-in

| 名称 | 参数与默认值 | 输出 | 失败或边界 |
| --- | --- | --- | --- |
| Contains | `words`、`text` 必填；`case_sensitive=false`；`require_all=false` | bool label；score 1/0；maximize | 空 words 返回 false。[S-CONTAINS] |
| Exact Match | `expected`、`actual` 必填；`case_sensitive=true` | bool label；score 1/0；maximize | 空白与换行参与比较。[S-EXACT] |
| Regex Match | `pattern`、`text` 必填；`full_match=false` | bool label；score 1/0；maximize | 默认在任意位置查找；复杂 regex 可能很慢。[S-REGEX] |
| Levenshtein Distance | `expected`、`actual` 必填；`case_sensitive=true` | 非负整数；minimize | 时间复杂度为 O(n×m)。[S-LEV] |
| JSON Distance | `expected`、`actual` 必填；`parse_strings=true` | 非负整数；minimize | JSON 文本无效时 score 为 null，并带错误解释。[S-JSON] |

#### 三个 LLM built-in

| 名称 | 作者映射 | 输出 |
| --- | --- | --- |
| Correctness | 通常只映射 `input`；experiment output 由模板自动格式化 | correct/incorrect、1/0、解释；maximize |
| Tool Selection | 通常只映射用户 `input`；tool calls 与工具定义自动格式化 | correct/incorrect、1/0、解释；maximize |
| Tool Invocation | 通常只映射用户 `input`；tool-call 参数自动格式化 | correct/incorrect、1/0、解释；maximize |

这三项使用 Phoenix-managed prompt 与服务端已配置的 Judge。它们不是 Python/TypeScript 11 个 LLM built-in 的完整镜像。[S-BUILTIN]

#### 服务端自定义 code evaluator

Python 函数名必须是 `evaluate`，参数名会成为映射项。TypeScript 入口是 `function evaluate(params: EvaluatorParams)`。[S-CODE]

返回对象可含 `label?: string`、`score?: number`、`explanation?: string`。annotation 配置另有 direction、可选上下界和可选 threshold。[S-CODE]

每次保存源码会创建 evaluator version。名称、说明、annotation 配置、input mapping 与 Sandbox 绑定则在 evaluator 本体上直接更新。[S-CODE]

本地 WebAssembly Python 与 Deno TypeScript 只能执行自包含代码，不能读变量、联网或安装第三方包。受管后端才提供这些能力。[S-CODE]

## 6. 可直接采用的完整场景

### 场景一：Python 确定性检查、字段映射与 DataFrame

安装只需 `arize-phoenix-evals==3.4.0`。下面程序同时证明映射、批量列和失败详情的形状。[CODE-EVALUATORS] [P-CORE]

```python
import pandas as pd

from phoenix.evals import Score, bind_evaluator, create_evaluator, evaluate_dataframe


@create_evaluator(name="answer_shape", kind="code")
def answer_shape(answer: str, required: str = "Paris") -> Score:
    matched = required.casefold() in answer.casefold()
    return Score(
        score=float(matched),
        label="pass" if matched else "fail",
        explanation=f"required token: {required}",
        metadata={"check": "substring"},
    )


bound = bind_evaluator(
    evaluator=answer_shape,
    input_mapping={
        "answer": "response.text",
        "required": "gold.city",
    },
)

rows = pd.DataFrame(
    [
        {"response": {"text": "Paris is the capital."}, "gold": {"city": "Paris"}},
        {"response": {"text": "Lyon is the capital."}, "gold": {"city": "Paris"}},
    ]
)

result = evaluate_dataframe(
    dataframe=rows,
    evaluators=[bound],
    hide_tqdm_bar=True,
    exit_on_error=False,
    max_retries=0,
)

assert result.loc[0, "answer_shape_score"]["score"] == 1.0
assert result.loc[1, "answer_shape_score"]["label"] == "fail"
assert result.loc[0, "answer_shape_execution_details"]["status"] == "COMPLETED"
print(result[["answer_shape_score", "answer_shape_execution_details"]])
```

### 场景二：Python 开放 Judge 与自定义 Mustache rubric

先安装 Judge SDK：

```bash
python -m pip install "arize-phoenix-evals==3.4.0" "openai>=1"
export OPENAI_API_KEY=your-key
```

程序采用官方 `ClassificationEvaluator` 形状。它不是字符串相等检查，而是让 Judge 按 rubric 对开放答案分类。[CUSTOM-LLM] [P-PROMPT]

```python
from phoenix.evals import ClassificationEvaluator, LLM


RUBRIC = """
You evaluate whether an answer is useful for the user's request.

<rubric>
helpful: directly answers the request and gives an actionable next step.
unhelpful: avoids the request, invents facts, or gives no actionable next step.
</rubric>

<input>{{input}}</input>
<output>{{output}}</output>
"""

judge = ClassificationEvaluator(
    name="helpfulness",
    llm=LLM(provider="openai", model="gpt-4o-mini"),
    prompt_template=RUBRIC,
    choices={"helpful": 1.0, "unhelpful": 0.0},
    include_explanation=True,
    direction="maximize",
    temperature=0,
)

scores = judge.evaluate(
    {
        "input": "How can I rotate an API key safely?",
        "output": (
            "Create the replacement key first, deploy it, verify traffic, "
            "then revoke the old key."
        ),
    }
)

score = scores[0]
score.pretty_print()
assert score.label in {"helpful", "unhelpful"}
assert score.score in {0.0, 1.0}
assert score.explanation
```

`pretty_print()` 自己打印并返回 `None`。例子只断言 schema，不把非确定 Judge 的某个 label 写死。[P-CORE]

### 场景三：TypeScript 整组分类 metric 与组合准入

沿用第 3 节的 Node 项目。三联工厂一次定义相同 beta、average 与正类规则，再由作者组合准入条件。[TS-METRICS]

```typescript
import {
  createPrecisionRecallFScoreEvaluators,
} from "@arizeai/phoenix-evals";

const labels = {
  expected: ["spam", "ham", "spam", "ham", "spam"],
  output: ["spam", "ham", "ham", "ham", "spam"],
};

const metrics = createPrecisionRecallFScoreEvaluators({
  positiveLabel: "spam",
  beta: 1,
  zeroDivision: 0,
});

const [precision, recall, f1] = await Promise.all([
  metrics.precision.evaluate(labels),
  metrics.recall.evaluate(labels),
  metrics.fScore.evaluate(labels),
]);

console.log({ precision, recall, f1 });

const passed =
  (precision.score ?? 0) >= 0.9 &&
  (recall.score ?? 0) >= 0.6 &&
  (f1.score ?? 0) >= 0.7;

if (!passed) process.exitCode = 1;
```

基础 evals 包没有 `allOf` 或 aggregate gate。上例的组合逻辑属于调用方；需要持久化 suite 级准入时可改用 Vitest/Jest `acceptanceCriteria`。[JS-TEST]

### 场景四：span DataFrame 判定并写回 Phoenix

该场景需要可访问的 Phoenix 项目。先安装固定版本，并按部署方式设置 `PHOENIX_BASE_URL` 与可选 `PHOENIX_API_KEY`。[PYPI-CLIENT]

```bash
python -m pip install \
  "arize-phoenix-evals==3.4.0" \
  "arize-phoenix-client==2.13.0"
export PHOENIX_BASE_URL=https://your-phoenix.example.com
export PHOENIX_API_KEY=your-key
```

自托管实例若不要求认证，可省略 API key。列名采用官方 trace 指南返回的 OpenInference DataFrame 形状。[TRACE-EVAL]

```python
import asyncio

from phoenix.client import Client
from phoenix.evals import ClassificationEvaluator, LLM, async_evaluate_dataframe
from phoenix.evals.utils import to_annotation_dataframe


client = Client()
spans = client.spans.get_spans_dataframe(
    project_identifier="my-project",
    limit=100,
)

eval_df = spans[["context.span_id", "attributes.llm.output_messages"]].copy()
eval_df = eval_df.set_index("context.span_id")
eval_df["answer"] = eval_df["attributes.llm.output_messages"].apply(
    lambda messages: messages[0]["message.content"]
)

judge = ClassificationEvaluator(
    name="answer_tone",
    llm=LLM(provider="openai", model="gpt-4o-mini"),
    prompt_template="Classify {{answer}} as professional or casual.",
    choices={"professional": 1.0, "casual": 0.0},
)

scored = asyncio.run(
    async_evaluate_dataframe(
        dataframe=eval_df,
        evaluators=[judge],
        concurrency=3,
        exit_on_error=False,
        hide_tqdm_bar=True,
    )
)
annotations = to_annotation_dataframe(scored, ["answer_tone"])
inserted = client.spans.log_span_annotations_dataframe(
    dataframe=annotations,
    sync=True,
)
print(f"inserted annotations: {len(inserted)}")
```

官方返回列会随 span kind 与查询选择变化。先检查 `spans.columns`，再固定项目所需的输入列；不要假定所有 span 都有 LLM output messages。[TRACE-EVAL]

## 7. 结果、诊断、artifact、CI 与补判

### 7.1 annotation 是 Phoenix 的持久结果

Phoenix 14 删除了旧 `/v1/evaluations`。span、trace 与 document 结果分别写到对应 annotation API。[MIGRATION]

| 被判对象 | Python 读取 | Python 写入 | 必要 ID |
| --- | --- | --- | --- |
| span | `Client().spans.get_spans_dataframe(..., limit=1000)` | `log_span_annotations_dataframe(..., sync=False)` | `span_id` 列或索引 |
| trace | `Client().traces.get_traces(..., include_spans=False, limit=100)` | `log_trace_annotations_dataframe(..., sync=False)` | `trace_id` 列或索引 |
| span 内 document | 从 retrieval span 的文档数组构造行 | `log_document_annotations_dataframe(..., sync=False)` | `span_id` 与 `document_position` |

三种 DataFrame 写入都接受全局或逐行的 annotation name 与 annotator kind。可选结果列是 score、label、explanation、metadata；span/trace 还可带 identifier。[CLIENT-PY]

`sync=False` 默认排队处理并返回 `None`。`sync=True` 等服务端完成并返回插入后的 annotation ID 列表；批量按 100 行分块。[CLIENT-PY]

`to_annotation_dataframe` 只认 `span_id`。trace 级作者要自行把 `Score` 展开成带 `trace_id` 的 DataFrame，不能直接复用这个转换器。[P-ANNOTATION] [CLIENT-PY]

TypeScript client 不用 DataFrame，而从 `spans` 与 `traces` 子路径接收对象。[CLIENT-TS]

| TypeScript API | 必填对象字段 | 返回与默认值 |
| --- | --- | --- |
| `addSpanAnnotation({spanAnnotation, sync?})` | `spanId`、`name`，以及 label、score、explanation 至少一个 | `Promise<{id}|null>`；`sync=false` 时为 null |
| `logSpanAnnotations({spanAnnotations, sync?})` | 上述对象数组 | `Promise<{id}[]>`；`sync=false` 时返回空数组 |
| `addTraceAnnotation({traceAnnotation, sync?})` | `traceId`、`name`，以及三个结果字段至少一个 | `Promise<{id}|null>`；`sync=false` 时为 null |
| `logTraceAnnotations({traceAnnotations, sync?})` | 上述对象数组 | `Promise<{id}[]>`；`sync=false` 时返回空数组 |
| `addDocumentAnnotation({documentAnnotation, sync?})` | `spanId`、从 0 起的 `documentPosition`、`name`，以及三个结果字段至少一个 | `Promise<{id}|null>`；`sync=false` 时为 null |
| `logDocumentAnnotations({documentAnnotations, sync?})` | 上述对象数组 | `Promise<{id}[]>`；`sync=false` 时返回空数组 |

六个函数的 `annotatorKind` 默认 HUMAN，API 失败都会 reject。span 与 trace 的 `identifier` 用于更新既有 annotation；trace 名称 `note` 被保留。[CLIENT-TS]

### 7.2 UI 诊断路径

客户端 evaluator 与服务端 evaluator 都会创建 OpenTelemetry evaluator trace。LLM 调用作为其子 span，score metadata 可带 evaluator `trace_id`。[P-CORE] [EVALUATOR-TRACES]

在 experiment 结果中先按 annotation label 或 score 排序，再打开异常样本。点击 annotation 可进入对应 evaluator trace，查看映射后输入、实际 prompt、Judge response、tool call、时延与 token 用量。[EVALUATOR-TRACES] [S-LLM]

服务端 LLM evaluator 的 prompt 每次保存都会建立 Prompt version。标签指向被采用的版本；没有标签时使用最近保存的版本。[S-LLM]

服务端 code evaluator 的 Test 面板会显示映射后的实参、原始返回对象，以及读取后的 label、score、explanation。适合在保存前发现路径或返回形状错误。[S-CODE]

### 7.3 artifact 边界

基础 evals SDK 没有通用 artifact 类型或附件 API。可保留的事实是 DataFrame、experiment run、annotation 和 evaluator trace。[P-CORE] [CLIENT-PY]

Judge prompt、model response 与调用详情存在 evaluator trace 中。若作者还要保存 rubric 文件、截图或任意二进制 artifact，需要自己的存储流程。

### 7.4 experiment 与补判

Python 主入口如下：[CLIENT-PY] [RUN-EXP]

```python
run_experiment(
    *, dataset, task, evaluators=None,
    experiment_name=None, experiment_description=None,
    experiment_metadata=None, rate_limit_errors=None,
    dry_run=False, print_summary=True, timeout=60,
    repetitions=1, retries=3, client=None,
) -> RanExperiment
```

同步 `run_experiment` 的 task 是同步函数。`async_run_experiment` 接受 sync 或 async task，并增加 `concurrency=3`。[CLIENT-PY]

evaluator 可按 `input`、`output`、`expected`/`reference`、`metadata`、`example`、`trace_id` 具名取值。单参数且不是这些名字时默认收到 task output。[CLIENT-PY]

```python
evaluate_experiment(
    *, experiment, evaluators, dry_run=False,
    print_summary=True, timeout=60,
    rate_limit_errors=None, retries=3, client=None,
) -> RanExperiment
```

它在既有 experiment runs 上增加评估，不再次执行 task。`async_evaluate_experiment` 增加 `concurrency=3`。[CLIENT-PY] [RUN-EXP]

`run_experiment` 和 `evaluate_experiment` 的 `dry_run=True` 选一条样本；整数只对前者选择 N 条。dry run 不上传，官方文档称抽样可重复。[RUN-EXP]

`resume_experiment(experiment_id=..., task=..., evaluators=None, timeout=60, retries=3)` 只补跑缺失或失败的 task run。它同步返回 `None`，也不支持多结果 evaluator。[CLIENT-PY]

`resume_evaluation(experiment_id=..., evaluators=...)` 只处理缺失或失败的同名 evaluation。它不支持一次返回多个结果的 evaluator。[CLIENT-PY]

Python client 自己也导出 `phoenix.client.experiments.create_evaluator(kind="CODE", name=None, scorer=None)`。它与 `phoenix.evals.create_evaluator` 不是同一个装饰器。[CLIENT-PY]

client 版用于 experiment 参数绑定，tuple 是 `(score,label[,explanation])`。evals 3.4 版则按元素类型猜测 tuple 字段；不要混用两套返回转换规则。[CLIENT-PY] [P-CORE]

TypeScript 的 experiment 作者面如下：[CLIENT-TS]

| API | 关键配置与默认值 | 作用 |
| --- | --- | --- |
| `asExperimentEvaluator({name, kind, evaluate})` | `kind` 为 annotation kind | 包装 experiment evaluator；标为 experimental |
| `fromPhoenixLLMEvaluator(evaluator)` | 只接 evals 包的 LLM evaluator | 转成 experiment evaluator；直接强制转换输入类型 |
| `getExperimentEvaluators(evaluators)` | 接 LLM evaluator 或带 name、kind、evaluate 的对象 | 规范化为 experiment evaluator；不支持的对象会抛错 |
| `runExperiment({...})` | `concurrency=5`、`record=true`、`dryRun=false`、`repetitions=1` | 执行 dataset task 与 evaluator；标为 experimental |
| `evaluateExperiment({...})` | `concurrency=5`、`dryRun=false` | 给内存中的 `RanExperiment` 增加判定；标为 experimental |
| `resumeExperiment({...})` | `concurrency=5`、`stopOnFirstError=false` | 补跑缺失或失败的 task，可随后运行 evaluator |
| `resumeEvaluation({...})` | `concurrency=5`、`stopOnFirstError=false` | 按名称查找既有 experiment 的缺失或失败判定并补齐 |

`resumeEvaluation` 不支持多结果 evaluator。`stopOnFirstError=true` 时以 `EvaluationAbortedError` 停止；读取待补项失败总是抛 `EvaluationFetchError`。[CLIENT-TS]

### 7.5 CI

pytest plugin 从 `arize-phoenix-client[pytest]>=2.10.0` 提供。test file 对应 dataset，参数化 case 对应 example，一次 pytest run 对应 experiment。[PYTEST]

| Python pytest 作者面 | 签名、默认值与行为 |
| --- | --- |
| `@pytest.mark.phoenix(...)` | 可配 dataset、两种 description、experiment metadata、evaluators、repetitions；未标记的测试不上传 |
| `log_output(output)` | 返回 `None`；同一 case 后一次调用替换前一次 output |
| `log_evaluation(...)` | name 必填；score、label、explanation、metadata 可选；`annotator_kind="CODE"`；同名后写值生效 |
| `evaluate(evaluator, /, **eval_input)` | 同步返回 evaluator 原结果；可驱动 sync 或 async evaluator；异常写入错误结果后重新抛出 |

三个函数只能在已标记的测试中调用，否则抛 `PhoenixContextError`。跳过的 case 不上传；repetitions 必须至少为 1。[CLIENT-PY] [PYTEST]

pytest 准入沿用普通 test outcome：`assert`、未捕获的 evaluator 异常与其他测试错误都会影响退出码。低分本身不失败；Phoenix 上传异常只产生 warning。[PYTEST]

Vitest 与 Jest 从各自 client 子路径导出相同作者面。[CLIENT-TS] [JS-TEST]

| TypeScript 测试作者面 | 签名、默认值与行为 |
| --- | --- |
| `describe(name, fn, config?)` | config 可含 datasetName、description、metadata、client、repetitions、dryRun、acceptanceCriteria |
| `test(name, params, fn, timeout?)` / `it` | params 的 input 必填；expected、reference、output 三个真值别名最多传一个；另可配 id、metadata、splits、repetitions、dryRun |
| `test.each(rows)(name, fn, timeout?)` | 每行成为 example；名称支持 `%i`、`%s`、`%j`；无占位符时追加从 1 开始的序号 |
| `logOutput(output)` | 返回 `void`；同一 run 后一次调用替换前一次 output |
| `logAnnotation(annotation)` | 可写 name、score、label、explanation、metadata、annotatorKind；保留名 `pass` 会被静默忽略 |
| `evaluate(evaluator, params?)` | 返回 evaluator 原结果；测试内自动补 input、output、expected、metadata 与 traceId，并写 annotation |
| `traceEvaluator(fn, {name?})` | 返回 async 包装函数；建立 evaluator span；返回值带 name 与合法 score 时自动写 annotation |

`describe.skip` 与 `test.skip` 不上传。`dryRun` 会在本地执行且参与 acceptance；repetitions 依次取 case、suite、进程变量、1。[CLIENT-TS]

```typescript
acceptanceCriteria: [
  {
    annotationName: "helpfulness",
    metric: "average",
    threshold: 0.8,
    direction: "maximize",
  },
  {
    annotationName: "valid_json",
    metric: "passRate",
    passFn: (annotation) => annotation.score === 1,
    minPassRate: 0.95,
  },
]
```

`average` 默认 direction 为 maximize。`passRate` 由作者提供 `passFn` 与最小通过率；准入条件在全部 test 完成后计算，并能让 runner 退出失败。[JS-TEST]

## 8. 自定义扩展

### 8.1 Python code evaluator

最短入口是 `@create_evaluator`。需要多个 score 时，应继承 `Evaluator`，实现 `_evaluate` 和可选 `_async_evaluate`，并直接返回 `list[Score]`。[P-CORE] [CODE-EVALUATORS]

自定义类要提供稳定唯一的 evaluator 与 score 名称。DataFrame runner 以名称派生列名，重复名称会让结果互相替换。[P-CORE]

### 8.2 Python 与 TypeScript 自定义 Judge

Python 用 `ClassificationEvaluator`；TypeScript 用 `createClassificationEvaluator`。两者都把离散 label 映射为数字，不提供连续自由分数 Judge 的预置构造。[P-CORE] [TS-LLM]

Python `choices` 可为 label 数组、label→number，或 label→`(number,description)`。最后一种由源码标为不推荐，因为模型不可靠地遵循该 schema。[P-CORE]

TypeScript `choices` 只接受 `Record<string,number>`，且总要求 explanation。若要返回任意连续数值，应使用 `createEvaluator` 包装自己的模型调用。[TS-LLM] [TS-CORE]

Python 可以从 Phoenix Prompt Management 转为 `PromptTemplate`。TypeScript 2.2.0 没有对应 Prompt-version 转换函数，只接收 string 或 AI SDK message list。[P-PROMPT] [TS-LLM]

### 8.3 服务端扩展

服务端 LLM evaluator 支持 Mustache prompt、label→score、方向、Provider/model 与调用参数。每次 prompt 变化都有版本，可在 Playground 先试跑。[S-LLM]

服务端 code evaluator 允许 Python 或 TypeScript `evaluate`，可组合规则、第三方 API 与多个 Judge。实际可用依赖与网络能力由选择的 Sandbox backend 决定。[S-CODE]

研究判断：服务端 code evaluator 是 Phoenix 中最接近“grader plugin”的入口。它仍绑定 dataset 与 Playground experiment，不是通用 npm/Python evaluator 发布格式。

## 9. 好在哪里

本节是基于前述官方事实的研究判断。

1. `bind_evaluator` 与 `bindEvaluator` 把数据整形从 rubric 中拆开。一个 evaluator 可复用于 trace、DataFrame 与 experiment，不必复制字段抽取逻辑。

2. Python 装饰器保留原函数可调用性。作者可以直接验证核心函数，又可通过 `.evaluate()` 获得 schema、统一 `Score` 和 evaluator trace。

3. `Score` 同时承载数字、标签、解释、kind 与 direction。LLM built-in 默认要求解释，UI 又能沿 annotation 进入实际 Judge trace。

4. Tool Selection、Tool Invocation 与 Tool Response Handling 分开建模。三种错误的输入字段和 rubric 不会混成一个含糊的 agent quality 分数。

5. async DataFrame runner 公开并发上限和重试开关，并保留逐 evaluator execution details。批量失败不会只剩一条顶层异常。

6. 服务端 evaluator 把 prompt 或源码版本、映射测试面板和历史 score 放到同一条诊断路径。团队成员不必分发本地 Judge key。

7. Vitest/Jest 明确区分逐 case invariant 与 suite aggregate。`passRate` 可用作者函数定义何为通过，比固定 `score >= x` 更灵活。

## 10. 不好的地方与不应类比 NiceEval 的边界

本节同样是研究判断。

1. Python、TypeScript、experiment client 与测试 adapter 有四套返回转换。最危险的差异是 Python bool→1/0，而 TypeScript bool→空对象。

2. Python 还用“三词以内是 label”的启发式。tuple 中后出现的数值会替换先前值，字典里的 metadata 又会被静默忽略。

3. 基础结果没有 `passed`、threshold、skip reason 或 typed error。DataFrame 把失败另放 execution-details 列，作者要自己把两类列重新关联。

4. `exit_on_error=True` 的名字像会抛错，实际却返回部分 DataFrame。默认最多重试 10 次，也可能让确定性编程错误重复执行很久。

5. Python DataFrame 以 score name 派生列名，没有结构化 namespace。同名 evaluator 或 score 会替换数据，组合多个第三方 evaluator 时风险更高。

6. TypeScript evals 没有 DataFrame 或通用 batch runner。分类聚合要求作者先收集完整 label 数组，再单独调用 metric。

7. 官方高层 Python API 页与 3.4.0 源码有漂移。Document Relevance、工具 evaluator 字段和 Exact Match label 都出现过旧形状。[PY-API] [P-METRICS]

8. SDK built-in、服务端 built-in 与 Legacy 页面不是同一集合。只看“Pre-Built Metrics”导航，无法判断某名字属于哪一执行面。

9. Phoenix 的服务端 evaluator 以 dataset 与 Playground 为中心。官方 server input-mapping 页把 incoming trace 支持写成未来方向，不能类比为在线 trace assertion engine。[S-INPUT]

10. `CorrectnessEvaluator` 没有 reference 或 context 输入。它是 Judge 的一般知识检查，不等同于有 golden answer 的确定性正确性证明。

11. evaluator trace 与 annotation 是 Phoenix 平台对象。NiceEval 若只吸收语法，不应假定自己也有同样的 trace 存储、Prompt version 或 UI 跳转能力。

## 11. 对 NiceEval 可吸收与不应复制

### 可吸收

- 把 input mapping 作为 evaluator 的可绑定配置，并让单次调用配置优先于绑定配置。
- 让 evaluator 自描述 name、kind、方向与输入 schema，便于 CLI 在执行前显示真实需求。
- 把 score、label、解释、metadata 与执行错误分开建模，不把 Judge 文本当最终判定对象。
- 为每次 evaluator 调用建立独立 trace，并让报告中的 score 能跳到准确输入与 Judge 调用。
- 把确定性 invariant 与开放质量信号分开；逐 case 失败和整组 aggregate 准入使用不同语法。
- 为 retry、timeout、并发与 partial result 给出公开配置和逐项诊断。
- 自定义 Judge 的 rubric 与 label→score 映射应可版本化，并在保存前对一条真实样本试跑。
- Tool Selection、Invocation、Response Handling 这类正交 evaluator 应保持独立，避免一个总分隐藏错误类别。

### 不应复制

- 不复制 bool、短字符串、长字符串和 tuple 的猜测式返回转换；应要求显式结果类型。
- 不用 DataFrame 列名承载 evaluator 身份；结果键应包含稳定 evaluator ID 与 metric name。
- 不让“失败”“无分”“跳过”都退化为 `None`；应使用可穷尽的状态联合与 reason。
- 不把 direction 当 threshold，也不把 UI 颜色当断言结果；准入策略应是独立可审计对象。
- 不复制 `exit_on_error` 返回部分结果却不抛错的命名；停止策略和错误传播应分开配置。
- 不把 SDK evaluator、experiment evaluator 与测试 evaluator 设计成相似名称下的不同转换规则。
- 不把服务端 Sandbox、Prompt Management 或 annotation UI 当 core 的必要依赖；这些应是可选 adapter。
- 不直接移植 Phoenix 的 built-in rubric 名称。NiceEval 需要写清输入真值、适用层级和误判代价。

## 12. 无法核实项

1. npm 没有给 `@arizeai/phoenix-evals@2.2.0` 或 client 7.3.0 提供 `gitHead`，也没有可辨识的对应 tag。本文只能固定 tarball digest，并报告它与 2026-08-09 仓库观察点相关源码相同。

2. 仓库存在 `arize-phoenix-evals-v4.0.0` tag，但 2026-08-09 的 PyPI latest release 仍是 3.4.0。本文没有把 4.0.0 tag 当作正式 Python 发布。

3. 官方文档没有给服务端 code/LLM evaluator 的通用 retry、timeout、失败 annotation 形状或资源上限。本文不推测这些运行细节。

4. Python Exact Match 官方页声称产生布尔 label，3.4.0 发布源码实际不产生 label。本文示例按发布源码写，文档意图无法替代运行事实。

5. Python `evaluate_dataframe` docstring 把 score 单元格称为 JSON 序列化对象，源码实际写入 Python 字典。本文按源码描述，跨 pandas 导出后的编码形状另由作者选择。

6. `to_annotation_dataframe` 只寻找 `span_id`，官方没有同构的 trace 转换器。trace DataFrame 的展开规则需由调用方定义。

7. 服务端 LLM built-in 的 managed prompt 会随 Phoenix 版本演进。本文只列 19.19.1 文档公开的名称、映射与输出，不把 prompt 文本视为永久协议。

8. 本轮没有 Phoenix 项目凭证，也没有发起会计费的 Judge 请求。场景二只验证构造，场景四按官方签名静态核对；服务端写入与 UI 跳转未做现场验收。

[PYPI-EVALS]: https://pypi.org/project/arize-phoenix-evals/3.4.0/

[NPM-EVALS]: https://registry.npmjs.org/@arizeai%2Fphoenix-evals

[PYPI-CLIENT]: https://pypi.org/project/arize-phoenix-client/2.13.0/

[NPM-CLIENT]: https://registry.npmjs.org/@arizeai%2Fphoenix-client

[SERVER-RELEASE]: https://github.com/Arize-ai/phoenix/releases/tag/arize-phoenix-v19.19.1

[REPO]: https://github.com/Arize-ai/phoenix/tree/b4d9b19e6c681cedcf627fc27dc48f13c7320b73

[P-CORE]: https://github.com/Arize-ai/phoenix/blob/arize-phoenix-evals-v3.4.0/packages/phoenix-evals/src/phoenix/evals/evaluators.py

[P-METRICS]: https://github.com/Arize-ai/phoenix/tree/arize-phoenix-evals-v3.4.0/packages/phoenix-evals/src/phoenix/evals/metrics

[P-PROMPT]: https://github.com/Arize-ai/phoenix/blob/arize-phoenix-evals-v3.4.0/packages/phoenix-evals/src/phoenix/evals/llm/prompts.py

[P-EXEC]: https://github.com/Arize-ai/phoenix/blob/arize-phoenix-evals-v3.4.0/packages/phoenix-evals/src/phoenix/evals/executors.py

[P-ANNOTATION]: https://github.com/Arize-ai/phoenix/blob/arize-phoenix-evals-v3.4.0/packages/phoenix-evals/src/phoenix/evals/utils.py

[P-LLM]: https://github.com/Arize-ai/phoenix/blob/arize-phoenix-evals-v3.4.0/packages/phoenix-evals/src/phoenix/evals/llm/wrapper.py

[TS-CORE]: https://github.com/Arize-ai/phoenix/tree/b4d9b19e6c681cedcf627fc27dc48f13c7320b73/js/packages/phoenix-evals/src

[TS-TYPES]: https://github.com/Arize-ai/phoenix/blob/b4d9b19e6c681cedcf627fc27dc48f13c7320b73/js/packages/phoenix-evals/src/types/evals.ts

[TS-LLM]: https://github.com/Arize-ai/phoenix/tree/b4d9b19e6c681cedcf627fc27dc48f13c7320b73/js/packages/phoenix-evals/src/llm

[TS-METRICS]: https://github.com/Arize-ai/phoenix/tree/b4d9b19e6c681cedcf627fc27dc48f13c7320b73/js/packages/phoenix-evals/src/code

[CLIENT-PY]: https://github.com/Arize-ai/phoenix/tree/78c381f670c5e1aca4ef4b5b3fa8b801ea06ee70/packages/phoenix-client/src/phoenix/client

[CLIENT-TS]: https://github.com/Arize-ai/phoenix/tree/b4d9b19e6c681cedcf627fc27dc48f13c7320b73/js/packages/phoenix-client/src

[EVAL-OVERVIEW]: https://github.com/Arize-ai/phoenix/blob/aa6d8e16/docs/phoenix/evaluation/evals.mdx

[INPUT-MAPPING]: https://github.com/Arize-ai/phoenix/blob/aa6d8e16/docs/phoenix/evaluation/concepts-evals/input-mapping.mdx

[EVALUATOR-TRACES]: https://github.com/Arize-ai/phoenix/blob/aa6d8e16/docs/phoenix/evaluation/llm-evals/evaluator-traces.mdx

[CODE-EVALUATORS]: https://arize.com/docs/phoenix/evaluation/how-to-evals/code-evaluators

[CUSTOM-LLM]: https://arize.com/docs/phoenix/evaluation/how-to-evals/custom-llm-evaluators

[EXACT-MATCH]: https://arize.com/docs/phoenix/evaluation/pre-built-metrics/exact-match

[PY-API]: https://arize.com/docs/phoenix/api/evaluation-models

[LEGACY-INDEX]: https://arize.com/docs/phoenix/evaluation/pre-built-metrics/q-and-a-on-retrieved-data

[TOXICITY]: https://arize.com/docs/phoenix/evaluation/pre-built-metrics/toxicity

[S-BUILTIN]: https://arize.com/docs/phoenix/evaluation/server-evals/pre-built-metrics

[S-INPUT]: https://arize.com/docs/phoenix/evaluation/server-evals/input-mapping

[S-LLM]: https://arize.com/docs/phoenix/evaluation/server-evals/llm-evaluators

[S-CODE]: https://arize.com/docs/phoenix/evaluation/server-evals/code-evaluators

[S-CONTAINS]: https://arize.com/docs/phoenix/evaluation/server-evals/pre-built-metrics/contains

[S-EXACT]: https://arize.com/docs/phoenix/evaluation/server-evals/pre-built-metrics/exact-match

[S-REGEX]: https://arize.com/docs/phoenix/evaluation/server-evals/pre-built-metrics/regex

[S-LEV]: https://arize.com/docs/phoenix/evaluation/server-evals/pre-built-metrics/levenshtein-distance

[S-JSON]: https://arize.com/docs/phoenix/evaluation/server-evals/pre-built-metrics/json-distance

[MIGRATION]: https://arize.com/docs/phoenix/release-notes/04-2026/04-07-2026-phoenix-v14-breaking-changes

[TRACE-EVAL]: https://arize.com/docs/phoenix/tracing/how-to-tracing/feedback-and-annotations/evaluating-phoenix-traces

[RUN-EXP]: https://github.com/Arize-ai/phoenix/blob/aa6d8e16/docs/phoenix/datasets-and-experiments/how-to-experiments/run-experiments.mdx

[PYTEST]: https://arize.com/docs/phoenix/evaluation/integrations/pytest

[JS-TEST]: https://arize.com/docs/phoenix/evaluation/integrations/vitest-jest
