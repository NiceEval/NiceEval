# 评估断言 API、语法与作者 DX

本目录一份文件对应一个产品。
每份独立指南都包含安装、最小可运行示例、完整断言或评分 API、失败语义、扩展方式、作者 DX 与 NiceEval 取舍。
本页只负责导航与横向判断，不替代各产品指南。

重点是调用点、判定层级、证据与失败反馈，不比较支持的模型、托管报表或价格。
这些材料只提供带日期的设计输入，不构成 NiceEval 目标契约。

## 观察范围

观察日期是 2026-08-09。

| 独立指南 | 观察快照 | 一手材料 |
|---|---|---|
| [Eve](eve.md) | `bd93f55481b3048d0273dd041b423e73fb9248cf`，包版本 `0.31.3` 后 3 commits | [源码](https://github.com/vercel/eve/tree/bd93f55481b3048d0273dd041b423e73fb9248cf/packages/eve/src/evals) 与 [Eval 文档](https://github.com/vercel/eve/tree/bd93f55481b3048d0273dd041b423e73fb9248cf/docs/evals) |
| [smevals](smevals.md) | `0067c0da2f28f534f9daf1ef4c37181450ddfa28`，PyPI `0.2.0` | [仓库](https://github.com/prime-radiant-inc/smevals/tree/0067c0da2f28f534f9daf1ef4c37181450ddfa28) 与 [PyPI](https://pypi.org/project/smevals/0.2.0/) |
| [Ori Eval](ori-eval.md) | `0.5.1+efbb19e`，构建于 2026-08-08 | [发布文章](https://openrouter.ai/blog/announcements/ori-eval/)、[Eval 指南](https://openrouter.ai/docs/guides/ori/eval) 与 [release manifest](https://github.com/OpenRouterLabs/ori-releases/blob/main/manifest.json) |
| [promptfoo](promptfoo.md) | 指南内固定的 npm 与源码快照 | [Assertions & Metrics](https://www.promptfoo.dev/docs/configuration/expected-outputs/) |
| [Inspect AI](inspect-ai.md) | 指南内固定的 PyPI 与源码快照 | [Scorers](https://inspect.aisi.org.uk/scorers.html) |
| [Braintrust AutoEvals](braintrust-autoevals.md) | 指南内固定的包与源码快照 | [AutoEvals](https://github.com/braintrustdata/autoevals) 与 [Scorer catalog](https://github.com/braintrustdata/autoevals/blob/main/SCORERS.md) |
| [DeepEval](deepeval.md) | 指南内固定的 PyPI 与源码快照 | [Metrics introduction](https://deepeval.com/docs/metrics-introduction) |
| [Pydantic Evals](pydantic-evals.md) | 指南内固定的包与源码快照 | [Evals](https://ai.pydantic.dev/evals/) |
| [OpenAI Graders](openai-graders.md) | 2026-08-09 的官方 API 文档 | [Graders](https://platform.openai.com/docs/guides/graders) |
| [LangSmith](langsmith.md) | 指南内固定的 SDK 与文档快照 | [Evaluation concepts](https://docs.langchain.com/langsmith/evaluation-concepts) |
| [Ragas](ragas.md) | 指南内固定的 PyPI 与源码快照 | [Available metrics](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/) |
| [Arize Phoenix](arize-phoenix.md) | 指南内固定的 PyPI 与源码快照 | [Evaluation](https://arize.com/docs/phoenix/evaluation/) |

`smeval` 这个名字有歧义。
本研究所指的是 Simon Willison 创建、Prime Radiant 维护的 `smevals`。
它不是 2020 年发布的 ShanMa Eval Toolbox，也不是 SemEval、Lean 的 `smeval`，或 FairPlay 的 SMEvals 服务。

后续产品使用滚动文档，无法像本地源码一样固定 commit。
因此本文只陈述观察日能由官方页面确认的 API 形状，不把页面内容当成长期兼容承诺。

## 先区分三种“断言”

各产品用同一个词描述不同层级。
直接比较方法数量，会把运行事实、单样本评分与数据集门槛混成一件事。

| 层级 | 回答的问题 | 代表产品 |
|---|---|---|
| Run Assertion | 这一次运行是否调用正确工具、完成、没超时、没超预算 | Eve、Ori Eval |
| Sample Scorer | 这一个输出与 reference、rubric 或 trace 相比得几分 | Inspect AI、Braintrust、DeepEval、Pydantic Evals、OpenAI Graders |
| Aggregate Gate | 一批样本按什么权重、统计量或显著性通过 | promptfoo、smevals；SigmaEval 是更纯粹的统计门槛参照 |

NiceEval 的作者面同时承担前两层，并把结果折叠进题内计分与 Verdict。
这使 scope、证据完整度和 `unavailable` 比单纯的 scorer 返回值更重要。

## 快速研究判断

| 产品 | 作者起点 | 最醒目的语法选择 | 主要 DX 收益 | 主要边界 |
|---|---|---|---|---|
| [Eve](eve.md) | `t`、session、turn | scope receiver + chainable handle | 领域事实短，任意值才走 `t.check` | 没有 Sandbox diff 与证据完整度 |
| [Ori Eval](ori-eval.md) | `run` | Jest 风格 `to*` 方法 | 普通 Bun test，行为、成本、耗时同面 | 工具断言面较窄，平台与 harness 绑定较深 |
| [smevals](smevals.md) | `grader.yaml` | ordered checks + executable checker | 文件协议小，任意语言可扩展，便于 regrade | 内置 matcher 极少，脚本数量增长快 |
| [promptfoo](promptfoo.md) | YAML `assert` | `type` + `value` + `threshold` + `weight` | 类型广，批量数据与组合门槛紧凑 | 字符串 DSL 与配置嵌套会隐藏类型错误 |
| [Inspect AI](inspect-ai.md) | `@scorer` | `Score(value, answer, explanation, metadata)` | `unscored` 与证据字段明确 | 自定义行为检查需要作者读 `TaskState` |
| [Braintrust](braintrust-autoevals.md) | scorer function | `(input, output, expected) -> Score` | scorer 是可独立调试的小单元 | 标准结果不表达控制流或证据完整度 |
| [DeepEval](deepeval.md) | metric object | `measure()` + `score/reason/threshold` | metric 可复用，理由与门槛就近 | 运行轨迹要先映射成 test case 或 trace |
| [Pydantic Evals](pydantic-evals.md) | `Evaluator` | typed context -> value or reason | 类型清楚，快检查与 Judge 可分层 | 主要是 Python code-first 作者面 |
| [OpenAI Graders](openai-graders.md) | JSON object | discriminated `type` + template strings | 内置类型与组合公式适合平台配置 | 不是运行 scope API，模板字段靠运行时求值 |
| [LangSmith](langsmith.md) / [Phoenix](arize-phoenix.md) | trace evaluator | trace mapping -> feedback / annotation | 线上与离线共用观测事实 | 强依赖 tracing 平台的数据模型 |
| [Ragas](ragas.md) | metric catalog | dataset + metrics | RAG 与 Agent 指标涉及范围广 | 更像研究指标库，不是行为断言 DSL |

## Eve：scope-first 的领域断言

Eve 把常用事实挂在 scope receiver 上。
`t` 观察整个 run，`session` 与 `turn` 提供更窄的证据快照。

```ts
await t.send("What is the weather in Brooklyn?");
t.succeeded();
t.calledTool("get_weather", {
  input: { city: "Brooklyn" },
  count: 1,
});
t.toolOrder(["search", "open"]);
```

matcher 接受 literal、`RegExp` 或 predicate。
对象使用 partial deep match，`count` 可以是精确数字或 predicate。
`toolOrder()` 只证明 request subsequence，不证明前一笔完成后下一笔才开始。

任意应用值进入另一条窄入口：

```ts
import { equals, includes, matches, similarity } from "eve/evals/expect";

t.check(t.reply, includes("Sunny"));
t.check(parsed, equals({ city: "Brooklyn" }));
t.check(payload, matches(WeatherSchema));
t.check(t.reply, similarity("Sunny, 72F")).atLeast(0.8);
```

每条断言返回 handle，作者在调用点选择严重度、阈值和标签：

```ts
t.calledTool("get_weather").soft();
t.check(t.reply, includes("source"))
  .label("source citation")
  .atLeast(0.8);
```

普通断言不会抛异常，也不可 `await`。
后续控制流依赖某项事实时，作者改用 `require` 或具名 lookup：

```ts
const turn = await t.send("Find the source and open it.");
const call = turn.requireToolCall("search");
await t.require(call.status, equals("completed"));
```

Judge 也返回同一种 handle。
默认 Judge 只采集分数，`.atLeast()` 或 `.gate()` 才建立门槛。

```ts
t.judge.autoevals
  .closedQA("answer cites a source")
  .label("citation")
  .atLeast(0.8);
```

Eve 的优势是调用点从领域事实开始。
作者不必先把 tool event 投影成值，再选择一个通用 matcher。
`message + metadata` 的失败事实也兼顾终端诊断和结构化 artifact。

它没有 NiceEval 的 Sandbox 文件断言、证据完整度、`unavailable` 和题内 points。
`eventsSatisfy()` 能表达跨 event 关系，但它把底层事件结构重新暴露给作者，应是逃生口而不是常用路径。

## smevals：YAML 编排，进程协议扩展

smevals 不提供可 import 的 Python 断言库。
作者用 YAML 排列 checks，复杂判断交给任意可执行文件。

```yaml
name: default
checks:
  - checker: contains
    value: "<svg"
    required: true
  - checker: ../checkers/render-svg
    input: extracted.svg
    creates: render.png
    required: true
  - checker: ../checkers/llm-judge-image
    image: render.png
    model: openai-codex/gpt-5.6-sol
    rubric: Score this image from 0 to 10.
scoring:
  pass_threshold: 0.5
```

内置 checker 只有 `contains` 与 `xml-valid`。
`required: true` 失败后，后续 checks 记为 skipped。
`creates` 让 checker 对它声称产生的 artifact 负责。

自定义 checker 以退出码表达 pass/fail，并可在 stdout 返回统一结果：

```json
{
  "score": 0.8,
  "metrics": { "syllables_ok": true },
  "tags": ["seasonal_reference"],
  "notes": "The final line is weak.",
  "details": { "raw_score": 8 }
}
```

`score` 范围是 0–1。
任一失败 check 没有自己的 score 时，Grade score 变成 `null`，不会沿用前一条 check 的旧分数。
整体 score 取最后一个有 score 的 check，因此 YAML 顺序同时承担生命周期与聚合语义。

这套设计最强的地方是协议小：shell、Python 或其它语言都能成为 checker。
Run 不可变，Grader 可换后重新评分，适合把昂贵生成与廉价 regrade 分开。

代价是复杂度从 DSL 转移到脚本目录。
作者要自己处理输入解码、schema、错误信息与 artifact；同类 matcher 也容易在多个 checker 中重复实现。

## Ori Eval：把 Agent run 做成 Bun test

Ori 的断言面最像 Jest matcher，但 receiver 是已经执行完成的 Agent run。

```ts
import { test } from "bun:test";
import { setupAgent } from "ori/eval";

const agent = setupAgent();

test("uses search without deleting files", async () => {
  const run = await agent.run("Where should I eat dinner in Lisbon?");

  run.tool("search").toBeCalled();
  run.tool("delete_file").toNotBeCalled();
  run.toComplete();
  run.toCostAtMost(0.01);
  run.toFinishWithin(30_000);
});
```

语法把 subject 与 matcher 拆成两段。
`run.tool("search")` 选择观察对象，`toBeCalled()` 表达关系。
完成、成本与耗时直接挂在 run 上，因此一条 test 可以同时约束质量与运行预算。

开放答案使用独立 Judge：

```ts
import { setupJudge } from "ori/eval";

const judge = setupJudge({ minScore: 0.8 });

await judge.autoEvals({
  criteria: "Cites the 14-day window and invents no exceptions.",
  run,
});
```

这条 API 的优势是新手熟悉：文件是普通 `*.eval.ts`，runner 是 Bun test，失败自然进入 CI 退出码。
`test.each()` 还能直接复用应用数据，`run.toMention()` 处理最常见的输出存在性检查。

边界也很清楚。
公开指南展示的是工具是否调用、是否完成、文本提及、成本与耗时，没有 Eve 那种 matcher object 或 typed event escape hatch。
Ori 的候选模型目录、baseline 和报告体验很完整，但它们属于实验编排，不应被误算成断言语言能力。

完整 API 与可运行示例见 [Ori Eval 独立指南](ori-eval.md)。

## promptfoo：声明式 matcher catalog 与组合门槛

promptfoo 把断言写进测试数据。

```yaml
tests:
  - vars:
      city: Paris
    assert:
      - type: contains
        value: Paris
      - type: is-json
      - type: llm-rubric
        value: The answer is grounded in the supplied context.
        threshold: 0.8
        weight: 2
```

它的特色不是单个 matcher，而是 catalog 与组合能力。
确定性字符串、JSON、SQL、相似度、成本、延迟、model-graded，以及 tool trajectory 都使用同一个 `type` 入口。

`threshold`、`weight`、assert-set、具名 metric 与 derived metric 让作者能在配置层定义聚合门槛。
统一结果包含 `pass`、`score` 与 `reason`，现成输出也可以单独重跑 assertions。

这种密度适合批量 prompt matrix。
它不适合承载复杂、带类型的运行事实：字符串缩写和嵌套 YAML 很紧凑，但 IDE 难以在 authoring 时证明字段和值匹配。

## Inspect AI：Score 是证据包，不只是数字

Inspect 的 scorer 是接收完整 `TaskState` 与 `Target` 的异步函数。

```py
@scorer(metrics=[accuracy(), stderr()])
def close_enough(rel_tol=0.01):
    async def score(state: TaskState, target: Target) -> Score:
        correct = compare(state.output.completion, target.text, rel_tol)
        return Score(
            value=CORRECT if correct else INCORRECT,
            answer=state.output.completion,
            explanation="numeric comparison",
            metadata={"relative_tolerance": rel_tol},
        )
    return score
```

`value` 可以是 `CORRECT`、`INCORRECT`、`PARTIAL`、`NOANSWER`，也可以是数字或复合值。
scorer 同时声明怎样把值聚合成 accuracy、mean 或 stderr。

`Score.unscored()` 是最值得注意的语义。
它让“没有足够证据评分”从错误分数中分离，聚合时可以明确跳过并统计 unscored samples。

`answer`、`explanation` 与 `metadata` 把提取值、人工解释和机器证据分开。
这种返回形状比单一 `number` 更适合诊断，也比自由结构对象更容易形成稳定报告。

Inspect 的 model grader 还显式处理 Judge prompt 定界、grade 提取与复现参数。
这些是 Judge runtime 的安全与稳定性问题，不应由每位 Eval 作者重复解决。

## Braintrust、DeepEval 与 Pydantic Evals：三种 scorer 形态

### Braintrust AutoEvals

Braintrust 把 scorer 做成小型纯函数或可调用对象：

```py
from autoevals import Score

def banana_scorer(output, expected, input):
    return Score(
        name="mentions_banana",
        score=1 if "banana" in output else 0,
        metadata={"expected": expected},
    )
```

标准 `Score` 让 scorer 可独立调试，再由 Eval runner 组合。
AutoEvals 同时提供字符串、JSON、SQL、RAG 与 LLM Judge scorer。
它最适合回答“这个样本得几分”，不直接表达 Agent 工具调用的 scope 与顺序。

### DeepEval

DeepEval 把 metric 做成有状态对象：

```py
metric = AnswerRelevancyMetric(threshold=0.5)
metric.measure(test_case)

print(metric.score)
print(metric.reason)
print(metric.is_successful())
```

`threshold` 把连续分数折成 pass/fail，`reason` 形成统一诊断。
`GEval`、DAG 与 agentic metrics 让相同对象模型支持主观 rubric、确定性决策树和 trace 质量。

`threshold=None` 可以只写入分数而不建立门槛。
`flaky=True` 可以保留失败但不让它影响测试判定。
两者都说明“采集指标”与“阻止合并”不应被同一个布尔值绑死。

### Pydantic Evals

Pydantic Evals 用 typed context 约束自定义 evaluator：

```py
from pydantic_evals.evaluators import EvaluationReason, Evaluator, EvaluatorContext

class MyEvaluator(Evaluator):
    def evaluate(self, ctx: EvaluatorContext) -> EvaluationReason:
        ok = ctx.output == ctx.expected_output
        return EvaluationReason(value=ok, reason="exact comparison")
```

内置 evaluator 包含 equals、contains、instance、duration、LLMJudge、GEval 与 span matching。
快而确定的 evaluator 可以先运行，昂贵 Judge 后运行。

类型参数和 `EvaluationReason` 提升了 code-first DX。
它仍然以 Python case 与 report 为中心，不能直接替代 TypeScript 的 scoped assertion receiver。

## OpenAI Graders：可序列化的判别联合

OpenAI Graders 把 grader 定义成带 `type` 的 JSON 对象。
字符串检查的最小形状是：

```json
{
  "type": "string_check",
  "name": "exact answer",
  "input": "{{sample.output_text}}",
  "reference": "{{item.label}}",
  "operation": "eq"
}
```

其它分支包括 `text_similarity`、`score_model`、`label_model`、`python` 与 `multi`。
`multi` 用 `calculate_output` 公式组合多个 grader 的结果。

这是一种适合网络 API、存储和 UI 编辑器的穷尽形状。
作者可以从类型判断所需字段，服务端也能先 validate grader，再执行。

代价是模板字符串只在运行时求值。
它也只看到传入的 sample 与 item，不拥有 Eve 或 NiceEval 那种 run、turn 或 Sandbox receiver。

## Trace 与指标平台的补充参照

LangSmith 与 Phoenix 都把判定接在 trace 之后。
作者先把 run、thread 或 span 字段映射成 evaluator 输入，再返回 score、label、comment 或 explanation。
优势是离线数据集与线上观测可以共享 evaluator，失败还能回到完整 trace。

它们提醒 NiceEval：判定 API 不应要求作者复制 observation。
Adapter 已产生的标准 event、trace 与 Sandbox diff 应直接成为 receiver 的输入事实。

Ragas 的重点是 metric catalog。
它包含 RAG faithfulness、context precision / recall、response relevance、tool call accuracy、goal accuracy 与 `rubric scoring`。
这对 Judge 配方与指标命名有参考价值，但不是 Agent 行为断言语法的直接参照。

## 对 NiceEval 的设计启发

### 1. 标准事实继续从 scope receiver 开始

Eve 与 Ori 都证明，常用 Agent 事实用领域方法最短：

```ts
turn.calledTool("search");
run.tool("search").toBeCalled();
```

让作者先提取 event、拼 JSON path 或构造递归 Match AST，会把 Adapter 结构泄漏进 Eval。
任意应用值仍需要 `check(value, assertion)`，但它不应成为所有标准事实的必经入口。

### 2. matcher、门槛与控制流是三件事

matcher 判断关系，门槛决定分数怎样影响 Verdict，控制流决定后续测试体是否继续。
Eve 的 assertion handle 与 `require`，以及 DeepEval 的 score-only 模式，都在主动分离这三件事。

NiceEval 不应让“有 threshold”自动等于“立即中止”。
题内 points、optional、gate 与 `unavailable` 应各自保留清晰语义。

### 3. 结果必须携带证据，不只携带分数

Inspect 的 `answer / explanation / metadata`、promptfoo 的 `reason`、DeepEval 的 `reason`，都让失败可以被人直接理解。

NiceEval 的 AssertionResult 应持续保留：

- 判定与 score；
- 观察到的值或命中项；
- 人可读 explanation；
- 证据完整度与 `unavailable` 原因；
- 可回到 event、trace 或 Sandbox diff 的 locator。

### 4. `unavailable` 不应折成 0 分

Inspect 的 `unscored`、Braintrust 的 `score=None` 与 smevals 的 `score: null` 都拒绝用假零分掩盖没有完成评分。
NiceEval 更进一步，还要说明证据为什么不完整。

这项差异值得保留。
缺失 event、opaque command 或证据命中范围未知，不等于被测行为明确失败。

### 5. 组合属于评分层，不属于 matcher

promptfoo 的 weight、assert-set 与 derived metric 很强，但它们操作的是 scorer 结果。
把加权、N 选 M 或派生公式放入每个 matcher，会让简单断言难以阅读。

NiceEval 应让单条断言稳定产出结果，再由 points、optional 与 Verdict 规则组合。

### 6. 逃生口要诚实地暴露成本

Eve 的 `eventsSatisfy()`、smevals 的 executable checker、OpenAI 的 Python grader 都能表达任意逻辑。
它们不可避免，但会绕开类型、标准诊断或安全边界。

NiceEval 可以保留 predicate 或 custom assertion 逃生口。
调用点与文档应明确：作者因此负责证据选择、失败说明、确定性与敏感数据处理。

## 不建议复制的做法

- 不把所有关系压成 promptfoo 式字符串 DSL；TypeScript 作者会失去补全与穷尽检查。
- 不把每个新 matcher 做成 smevals 式独立进程；常见事实会产生重复协议与脚本维护成本。
- 不把 Judge 的 prompt 定界、输出解码和重试交给 Eval 作者；这应由 Judge runtime 统一处理。
- 不把 `toolOrder()` 命名或文案写成完整时序保证；subsequence 与 finish-before-start 必须分开。
- 不把 trace 平台的 field mapping 暴露成核心 Assertion API；标准 Adapter 已经负责归一化 observation。
- 不用一条布尔 `passed` 同时表示匹配结果、门槛、控制流、可用性与最终 Verdict。

## 还需要的证据

这份研究比较静态 API 与官方示例，没有用同一组真实任务跑每个产品。
要判断哪种 DX 在 NiceEval 中更好，下一步应使用相同的三类题目做 authoring exercise：

1. 工具存在、参数、负断言与 request subsequence；
2. 文件 diff、动态 locator 与跨 event 因果；
3. 开放答案 Judge、`unavailable` 与题内部分分。

比较时逐项写下调用点长度、需要理解的底层 schema、失败信息、错误地通过的边界，以及修改 rubric 后能否只 regrade。
否则“语法更短”只能说明 demo 更短，不能证明它在真实回归题里更可靠。
