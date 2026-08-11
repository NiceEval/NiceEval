# Braintrust AutoEvals 与 Eval scorer 作者指南

> 观察日期：2026-08-09。
>
> 本文研究 Braintrust TypeScript / Python Eval、AutoEvals、scorer、classifier、断言与汇总作者面。
> 它不是 NiceEval 产品契约，也不盘点无关的 provider、部署或观测 SDK。

## 1. 定位与真实边界

**官方事实。** `autoevals` 是可单独使用的开源判分库。
它把 `output`、可选 `expected` 和额外输入交给 scorer，返回 `Score`。
Braintrust SDK 的 `Eval()` 则负责数据、任务、并发判分、trace、实验保存与汇总。
[AutoEvals 仓库][AE-ROOT]与[实验代码指南][DOC-RUN]把两层放在同一示例中，但并不要求绑定使用。

**官方事实。** Braintrust 的质量值名为 score，通常位于 `0..1`。
普通 Eval 不带“低于多少就抛错”的内建断言语义。
低分仍是成功执行；形成行级 error 的 task / runner 异常才会让默认 CLI reporter 失败。
单个 scorer 异常只写诊断，也不会自动把 CLI 变成失败。
[CI 指南][DOC-CI]要求用自定义 `Reporter` 才能把分数阈值变成退出码。

**官方事实。** `LLMClassifier` 这个 AutoEvals 名称容易误读。
它强迫 Judge 选一个 choice，再用 `choice_scores` 映射成数值 `Score`。
Braintrust `classifiers` 是另一条通道，返回 `Classification`，不会进入数值 score 汇总。
[AutoEvals LLM 源码][AE-LLM] [AE-PY-LLM]与[Eval 源码][BT-TS-EVAL]分别定义了这两个协议。

**官方事实。** Braintrust 另有 TypeScript-only 的 `agentAssertionScorer`。
它把多个断言折成一个比例 score，并把逐条成败放进 score metadata。
Python SDK 0.32.0 没有同名导出。
[TypeScript 断言源码][BT-TS-ASSERT]与[trace scorer 指南][DOC-CUSTOM]给出该能力。

**研究判断。** 这套系统的中心抽象仍是“实验行经过任务后被多个 scorer 判分”。
它不是通用测试运行时，也不把每条失败断言提升成独立测试状态。
断言、Judge 和人工反馈最后都会成为实验表中的 score、classification 或 feedback。

**真实边界。** 官方 AutoEvals 页面说内建 scorer 面向单个 span，不面向整条 trace。
但 0.3.0 的 `LLMClassifier` 已能在模板引用 thread 变量时读取 `trace.getThread()`。
内建 YAML 模板没有使用这些变量，因此不能把全部 AutoEvals 宣称为 trace grader。
[AutoEvals 页面][DOC-AUTOEVALS]与[LLM 源码][AE-LLM] [AE-PY-LLM]共同限定了这个边界。

## 2. 观察快照与一手链接

本文优先采用固定 commit 的公开源码。
滚动文档用观察日期限定；发布页用包版本限定。
除明确写出“研究判断”的段落外，catalog 陈述均可在下表定位。

| 一手材料 | 固定点 | 本文据此确认的事实 |
| --- | --- | --- |
| [AutoEvals 仓库][AE-ROOT] | commit `b0e1055892bea1305a10f8d42fdc47ff1b41ffa4` | 公开导出、模板、算法与包版本 |
| [AutoEvals TS Score][AE-TS-SCORE] | 同一 commit | `Score`、`Scorer`、`ScorerArgs` |
| [AutoEvals Python Score][AE-PY-SCORE] | 同一 commit | `Score`、`Scorer`、同步与异步入口 |
| [AutoEvals TypeScript LLM][AE-LLM] | 同一 commit | Judge、模板、thread 变量、默认配置 |
| [AutoEvals Python LLM][AE-PY-LLM] | 同一 commit | 构造器、同步 / 异步 Judge 与 spec 读取 |
| [AutoEvals RAG][AE-RAG] | 同一 commit | 八个 RAG scorer 的算法与 metadata |
| [AutoEvals Python RAG][AE-PY-RAG] | 同一 commit | Python 默认值、同步与异步实现差异 |
| [AutoEvals TypeScript 基础 scorer][AE-BASE] | 同一 commit | 字符串、JSON、列表、数值与精确匹配 |
| [AutoEvals Python 基础 scorer][AE-PY-BASE] | 同一 commit | Python 公式、依赖与执行差异 |
| [AutoEvals TypeScript client][AE-OAI] | 同一 commit | client、模型默认值与请求路径 |
| [AutoEvals Python client][AE-PY-OAI] | 同一 commit | `ContextVar`、client 与模型默认值 |
| [AutoEvals TypeScript partial][AE-PARTIAL] | 同一 commit | 函数偏应用与合并顺序 |
| [AutoEvals Python partial][AE-PY-PARTIAL] | 同一 commit | 子类偏应用与构造边界 |
| [AutoEvals TypeScript moderation][AE-MODERATION] | 同一 commit | threshold、metadata 与 client |
| [AutoEvals Python moderation][AE-PY-MODERATION] | 同一 commit | 同步 / 异步请求与弃用参数 |
| [AutoEvals 清单][AE-MANIFEST] | 同一 commit | UI 分组清单及其漏项 |
| [npm `autoevals@0.3.0`][NPM-AE] | 2026-06-09 发布元数据 | TypeScript 安装版本 |
| [PyPI `autoevals==0.3.0`][PYPI-AE] | 2026-06-09 发布元数据 | Python 安装版本与 Python 3.10+ |
| [Braintrust JS SDK][BT-TS-ROOT] | commit `f790a3a5bff2233bb1de78b31f69a4d4062269a1` | `braintrust@3.27.0` 源码快照 |
| [TypeScript Eval][BT-TS-EVAL] | 同一 commit | `Eval()`、runner、空分、异常与本地平均值 |
| [TypeScript 断言][BT-TS-ASSERT] | 同一 commit | `agentAssertionScorer` 的九个断言函数 |
| [TypeScript Vitest wrapper][BT-TS-VITEST] | 同一 commit | `wrapVitest` 的 test、expect 与 scorer 接口 |
| [TypeScript function builder][BT-TS-FN] | 同一 commit | 保存 scorer / classifier 与复用远端函数 |
| [TypeScript Score][BT-SCORE] | 同一 commit | `Score` 与 `Classification` |
| [TypeScript stream][BT-STREAM] | 同一 commit | `BraintrustStream` 的消费语义 |
| [Braintrust Python SDK][BT-PY-ROOT] | commit `a82dc20e5a07af675069110a99b4723272f4703d` | `braintrust==0.32.0` 源码快照 |
| [Python Eval][BT-PY-EVAL] | 同一 commit | `Eval()`、`EvalAsync()`、runner 与 reporter |
| [Python function builder][BT-PY-FN] | 同一 commit | 保存 scorer / classifier 与远端调用 |
| [Python Score][BT-PY-SCORE] | 同一 commit | `Score` 与 `Classification` |
| [Python stream][BT-PY-STREAM] | 同一 commit | 同步与异步最终值入口 |
| [npm `braintrust@3.27.0`][NPM-BT] | 2026-08-04 发布元数据 | TypeScript SDK 安装版本 |
| [PyPI `braintrust==0.32.0`][PYPI-BT] | 2026-08-05 发布元数据 | Python SDK 安装版本与 Python 3.10+ |
| [实验代码指南][DOC-RUN] | 观察日页面 | 安装、CLI、trial、trace 与本地模式 |
| [自定义 scorer 指南][DOC-CUSTOM] | 观察日页面 | inline、push、UI、trace、返回形状 |
| [Judge 指南][DOC-JUDGE] | 观察日页面 | LLM Judge、classifier 与 scope |
| [结果解释][DOC-RESULTS] | 观察日页面 | 表格、trace、过滤与诊断 |
| [实验比较][DOC-COMPARE] | 观察日页面 | 对齐、差值、trial 与聚合选项 |
| [CLI reference][DOC-CLI] | 观察日页面 | `bt eval` 参数和非最终抽样标记 |
| [CLI quickstart][DOC-CLI-QUICK] | 观察日页面 | beta 状态、安装方式与 Python runner |
| [TypeScript API reference][DOC-TS-API] | 页面标示 3.8.0 | 滚动 API 页的展示版本边界 |
| [函数部署指南][DOC-DEPLOY] | 观察日页面 | 保存、推送与调用 scorer |
| [在线判分][DOC-ONLINE] | 观察日页面 | rule、sampling、filter 与 scope |
| [人工反馈][DOC-FEEDBACK] | 观察日页面 | score、expected、comment、tags |
| [重跑 scorer][DOC-RESCORE] | 观察日页面 | 不重跑 task 的三条平台路径 |

固定 commit 比发布日晚并不表示存在未发布 API。
三个仓库在观察日的源码版本字段正好分别是 0.3.0、3.27.0 与 0.32.0。
本文仍把包版本与 commit 都写出，避免把后续滚动页面倒灌进快照。

## 3. 安装、最小项目与首个可运行 Eval

### 3.1 TypeScript：不登录、不调用模型

```bash
mkdir braintrust-eval-smoke
cd braintrust-eval-smoke
pnpm init
pnpm add braintrust@3.27.0 autoevals@0.3.0
```

把下面内容保存为 `exact.eval.ts`：

```typescript
import { Eval } from "braintrust";
import { ExactMatch } from "autoevals";

Eval("braintrust-author-smoke", {
  experimentName: "exact-local",
  data: [
    { input: "paris", expected: "PARIS", metadata: { case: "upper" } },
    { input: "taipei", expected: "TAIPEI", metadata: { case: "upper" } },
  ],
  task: (input) => input.toUpperCase(),
  scores: [ExactMatch],
});
```

执行：

```bash
pnpm exec bt eval --no-send-logs exact.eval.ts
```

`--no-send-logs` 仍执行 task 和 scorer，只是不创建远端 experiment。
本例不需要 API key，也没有模型费用，终端应显示 `ExactMatch` 为 100%。
[实验代码指南][DOC-RUN]与[CLI reference][DOC-CLI]确认了文件发现和本地模式。

直接从程序调用时，应等待返回值，并把运行选项放在第三个参数：

```typescript
const result = await Eval(
  "braintrust-author-smoke",
  { data, task, scores },
  { noSendLogs: true },
);
console.log(result.summary, result.results);
```

这与文档某些把 `noSendLogs` 放入 evaluator 对象的旧示例不同。
3.27.0 的公开签名把它定义在 `EvalOptions` 中。[TypeScript Eval 源码][BT-TS-EVAL]是本文依据。

### 3.2 Python：同一个本地实验

两个 Python 包都要求 Python 3.10 或更高版本。

```bash
python -m venv .venv
. .venv/bin/activate
python -m pip install braintrust==0.32.0 autoevals==0.3.0
```

把下面内容保存为 `eval_exact.py`：

```python
from braintrust import Eval
from autoevals import ExactMatch

result = Eval(
    "braintrust-author-smoke",
    experiment_name="exact-local-python",
    data=[
        {"input": "paris", "expected": "PARIS", "metadata": {"case": "upper"}},
        {"input": "taipei", "expected": "TAIPEI", "metadata": {"case": "upper"}},
    ],
    task=lambda input: input.upper(),
    scores=[ExactMatch],
    no_send_logs=True,
)

print(result.summary)
```

直接执行，不需要另装 CLI：

```bash
python eval_exact.py
```

Python 的 `Eval()` 是同步入口。
Jupyter 或已有 event loop 中应改用 `await EvalAsync(...)`。
[Python Eval 源码][BT-PY-EVAL]明确区分了两个入口。

官方 `bt eval` 也能运行 Python 文件，但 `bt` 是单独的 beta CLI。
仅按上面的 pip 命令安装 SDK 时，直接运行脚本是依赖最少的路径。
[CLI quickstart][DOC-CLI-QUICK]给出独立安装方式和 Python runner 选择规则。

### 3.3 何时才需要凭证

上传 experiment 需要 `BRAINTRUST_API_KEY`。
AutoEvals 的 Judge、embedding 与 moderation 还要能访问对应模型端点。
默认端点是 Braintrust AI Gateway；也可通过 `init()` 注入 OpenAI-compatible client。
[TypeScript client][AE-OAI]与[Python client][AE-PY-OAI]给出选择顺序和默认模型。

## 4. 核心数据流与对象关系

```text
EvalData / Dataset / BaseExperiment
              │
              ▼
         EvalCase × trial
   input + expected + metadata + tags
              │
              ▼
       task(input, hooks) ────────> output + task trace
              │                         │
              └────────────┬────────────┘
                           ▼
              scores[] 与 classifiers[] 并发
                  │                    │
                  ▼                    ▼
             Score / number       Classification
                  │                    │
                  └──────────┬─────────┘
                             ▼
                  EvalResult + scorer spans
                             │
                             ▼
             本地 summary 或远端 experiment summary
```

task 完成后，runner 才启动该行的 scorers 和 classifiers。
同一行内的所有 scorer 与 classifier 并发运行。
某个 scorer 抛错会写入 `metadata.scorer_errors`，不会取消同一行的其它 scorer。
[TypeScript runner][BT-TS-EVAL]与[Python runner][BT-PY-EVAL]实现了这条顺序。

### 4.1 五层 metadata

| 层 | 写入入口 | scorer 能否直接收到 | 查看位置 |
| --- | --- | --- | --- |
| experiment | `Evaluator.metadata` / `metadata=` | 否 | experiment 详情与过滤 |
| 数据行 | `EvalCase.metadata` | 是 | 根 eval span 与 scorer 参数 |
| task 动态值 | `hooks.metadata` 原地修改 | 是 | 根 eval span与 scorer 参数 |
| score | `Score.metadata` | 不会并入下一位 scorer | 独立 scorer span |
| 保存的 scorer | builder 的 `metadata` | 不是行参数 | scorer 定义；可放 `__pass_threshold` |

Score metadata 是诊断信息，不会出现在 `EvalResult.scores` 的数值 map 中。
`LLMClassifier` 的 choice 与 rationale、RAG 的中间判断、组合 scorer 的配对都放在这里。
[结果解释][DOC-RESULTS]说明 UI 可展开 scorer span 查看解释。

### 4.2 异步、数据流与模型流

TypeScript `EvalData` 接受数组、同步或异步工厂、`Promise<Array>`、`AsyncGenerator`、`AsyncIterable` 和 `BaseExperiment`。
Python 接受 iterable、iterator、dataset、`BaseExperiment`，runner 也能迭代 async generator。
[两个 Eval 源码][BT-TS-EVAL] [BT-PY-EVAL]给出实际形状。

task 与 scorer 都可同步或异步。
Python runner 会在线程池运行同步函数，并优先调用 scorer 对象的 `eval_async()`。
TypeScript 用 `Promise.resolve()` 统一两种返回。

`EvalOptions.stream` 与 Python `stream=` 接收的是 `hooks.reportProgress()` 事件。
它不是自动收集模型 token 的回调。
若 task 调用 `invoke(..., { stream: true })`，应先取 `await stream.finalValue()` 再返回给 scorer。
Python 对应 `final_value()` 或 `await final_value_async()`。
[TS stream][BT-STREAM]与[Python stream][BT-PY-STREAM]说明消费与复制语义。

TypeScript CLI 的 `--no-send-logs` 不建立 experiment logger。
若作者也没有另建 parent 或 logger，root span 会成为 no-op span。
普通本地 scorer 仍可运行，但 trace scorer 不应假定此模式能看到包装 client 产生的 spans。
[TypeScript Eval 源码][BT-TS-EVAL]显示了本地执行分支。

## 5. 完整 API catalog

### 5.1 `Score`、`Scorer` 与 `Classification`

TypeScript AutoEvals 与 Braintrust core 使用同形协议：

```typescript
interface Score {
  name: string;
  score: number | null;
  metadata?: Record<string, unknown>;
  /** @deprecated */ error?: unknown;
}

type ScorerArgs<Output, Extra> = {
  output: Output;
  expected?: Output;
} & Extra;

type Scorer<Output, Extra> = (
  args: ScorerArgs<Output, Extra>,
) => Score | Promise<Score>;
```

Python AutoEvals 用对象协议：

```python
@dataclass
class Score:
    name: str
    score: float | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    error: Exception | None = None  # deprecated

class Scorer(ABC):
    async def eval_async(self, output, expected=None, **kwargs) -> Score: ...
    def eval(self, output, expected=None, **kwargs) -> Score: ...
    def __call__(self, output, expected=None, **kwargs) -> Score: ...
```

`braintrust.Score` 与 `autoevals.Score` 是两个类，但字段、区间校验和 `as_dict()` 协议相同。
Python runner 按 `ScoreLike` 结构接收两者。
`braintrust.score.Scorer` 也实现同一组方法，但 package root 没有导出它；常规作者可用函数或 AutoEvals 类。
[Braintrust Python Score 源码][BT-PY-SCORE]给出这层兼容协议。

`Score.score` 的契约是 `0..1` 或 `null` / `None`。
Python `Score` 构造器会拒绝区间外值；TypeScript interface 本身没有运行期检查。
`error` 已废弃，正确做法是抛异常，让 Eval runner 保存 scorer error。
[AutoEvals Score 源码][AE-TS-SCORE] [AE-PY-SCORE]是这组签名的固定依据。

Braintrust TypeScript 的真实 span logger 会把 boolean 转为 1 / 0，并拒绝非数值或区间外 score。
普通 no-send 路径使用 no-op span，本地汇总本身不会补做这项校验。
作者不应把一次本地通过当成越界 score 可上传的证明。[logger 源码][BT-FEEDBACK]包含同一校验函数。

Braintrust Eval 接受更宽的 scorer 返回：

| 返回形状 | TypeScript 行为 | Python 行为 |
| --- | --- | --- |
| `number` | 以函数名生成一个 score | 以函数名生成一个 `Score` |
| `boolean` | 运行期按 true 1、false 0 使用，类型未声明 | `bool` 是公开返回类型，同样按 1 / 0 汇总 |
| `Score` / dict | 采用对象中的 `name`、`score`、`metadata` | dict 先转换为 `Score` |
| `Score[]` / sequence | 每项必须是具名对象；生成多列 | 每项必须符合 `ScoreLike` |
| 空数组 / 空 sequence | 不写 score | 不写 score |
| 顶层 `null` / `None` | 整个 scorer 不写 score | 写一个函数名对应的空分 |
| `Score(name, null)` | 写具名空分 | 写具名空分 |
| 抛异常 | 该 scorer 失败，其它 scorer 继续 | 该 scorer 失败，其它 scorer 继续 |

空分不参加本地平均值。
TypeScript 顶层 `null` 连列名也不保留；Python 顶层 `None` 会保留具名空分。
跨语言 scorer 若依赖“跳过但保留列”，应显式返回 `Score(name, null)`。
[TypeScript runner][BT-TS-EVAL]与[Python runner][BT-PY-EVAL]显示了这个差异。

TypeScript 类型要求结构化结果带 name 与 score，但 runner 对对象只做很弱的运行期检查。
数组项只要是非空对象就可能继续执行，缺 name 会形成错误列键；Python 会拒绝缺字段对象。
作者不应把 TypeScript 的宽松运行期行为当作公开扩展点。

Braintrust classifier 的 TypeScript 形状是：

```typescript
interface Classification {
  name: string;
  id: string;
  label?: string;
  metadata?: Record<string, unknown>;
}
```

Python `Classification(id, name=None, label=None, metadata=None)` 对 `name` 可省略。
两端 runner 都会用 classifier 函数名补齐名称。
TypeScript 还会把缺失的 `label` 补成 `id`；Python 保存项会省略 `label`。

classifier 顶层空值或空数组表示跳过，异常写入 `metadata.classifier_errors`。
它不会进入 `summary.scores`。
[TypeScript Score][BT-SCORE]与[Python Score][BT-PY-SCORE]给出对象和序列化差异。

### 5.2 TypeScript `Eval()` 全量配置

```typescript
async function Eval<Input, Output, Expected, Metadata, Report, Parameters>(
  name: string,
  evaluator: Evaluator<Input, Output, Expected, Metadata, Parameters>,
  reporterOrOpts?: ReporterDef<Report> | string | EvalOptions<Report, Parameters>,
): Promise<EvalResultWithSummary<Input, Output, Expected, Metadata>>;
```

`name` 是 Braintrust project 名。
CLI lazy-load 时，调用先注册 evaluator；直接执行时返回完整结果。
[TypeScript Eval 源码][BT-TS-EVAL]是完整签名依据。

在 `bt eval` 的 lazy-load 路径中，第三参数只保留 reporter。
本地模式、进度、筛选与本次参数由 CLI 自己传入；`noSendLogs` 一类运行选项应改用 CLI flag。
直接从应用等待 `Eval()` 时，第三参数才完整生效。

#### `Evaluator`

| 字段 | 类型与默认值 | 作者可观察语义 |
| --- | --- | --- |
| `data` | `EvalData`，必填 | 数组、工厂、promise、异步 iterable、dataset 或 `BaseExperiment` |
| `task` | `(input, hooks)`，返回 `Output` 或 `Promise<Output>` | 必填；每行每个 trial 调一次 |
| `scores` | `EvalScorer[]` | 与 `classifiers` 至少提供一项 |
| `classifiers` | `EvalClassifier[]` | 写 classification，不参与数值平均 |
| `parameters` | schema、远端 parameters 或 promise | 校验后传给 task 的 `hooks.parameters` |
| `experimentName` | `string` 或 `undefined` | 未提供时由 SDK 生成 experiment 名 |
| `description` | `string` 或 `undefined` | experiment 描述 |
| `trialCount` | `number` 或 `undefined`，实际默认 1 | 每个输入的重复次数；行级 `trialCount` 优先 |
| `metadata` | JSON object | experiment 级过滤信息 |
| `tags` | `string[]` | experiment tags；行也可有自己的 tags |
| `isPublic` | `boolean`，默认 `false` | experiment 是否公开 |
| `update` | `boolean`，默认 `false` | 同名 experiment 存在时是否更新 |
| `timeout` | 毫秒，默认无 | 整个 evaluator 超时 |
| `signal` | `AbortSignal` 或 `undefined` | 取消 evaluator |
| `maxConcurrency` | `number` 或 `undefined`，默认无限制 | task 和 scorer 共用并发上限 |
| `projectId` | `string` 或 `undefined` | 用 ID 代替 `name` 找 project |
| `state` | `BraintrustState` 或 `undefined` | 使用指定登录与 logger 状态 |
| `baseExperimentName` | `string` 或 `undefined` | 指定比较 experiment 名 |
| `baseExperimentId` | `string` 或 `undefined` | 指定比较 ID；优先于名称 |
| `gitMetadataSettings` | `GitMetadataSettings` 或 `undefined` | 控制 Git 信息采集 |
| `repoInfo` | `RepoInfo` 或 `undefined` | 显式 Git 信息；优先于设置 |
| `errorScoreHandler` | handler，默认无 | 为 task 或 scorer error 补数值；不会自动启用默认实现 |
| `summarizeScores` | `boolean`，默认 `true` | 是否请求 experiment score summary |
| `flushBeforeScoring` | `boolean` 或 `undefined`，实际默认关闭 | 判分前先 flush trace spans |

`EvalCase` 的作者字段是 `input`、可选 `expected`、`metadata`、`tags` 与 `trialCount`。
dataset 行还可带 ID、事务 ID、创建时间、origin 与 upsert ID。
常规 inline 作者不应伪造这些内部身份字段。

#### task hooks

| 字段 | 语义 |
| --- | --- |
| `metadata` | 当前行的可变对象；修改会传给 scorer |
| `expected` | 当前行参考值 |
| `span` | task 所在 span |
| `parameters` | 已校验参数；数组参数已变成单值 |
| `reportProgress(event)` | 向 playground / `EvalOptions.stream` 发送进度 |
| `trialIndex` | 从 0 开始的 trial 序号 |
| `tags` | 当前行 tags |
| `meta(info)` | 已废弃；改写 `metadata` |

#### `EvalOptions`

| 字段 | 默认值 | 语义 |
| --- | --- | --- |
| `reporter` | 默认 reporter | 对单 evaluator 和全 run 做汇报 |
| `noSendLogs` | `false` | 本地执行，不创建 experiment |
| `onStart` | 无 | experiment 建立后收到不含 scores / metrics 的 summary |
| `stream` | 无 | 接收 task 进度事件，不是模型 token 流 |
| `parent` | 无 | 把 Eval 写入现有 parent，而非新 experiment |
| `progress` | 默认进度器 | 旧式 progress 接口，源码提示未来可能移除 |
| `parameters` | `{}` | 本次参数值，受 evaluator schema 校验 |
| `returnResults` | `true` | `false` 时只增量汇总，返回的 `results` 为空 |
| `enableCache` | `true` | 启用磁盘 span cache，便于 trace scorer 读 spans |

#### 返回值

`EvalResultWithSummary` 含 `summary` 与 `results`。
每个 `EvalResult` 含输入、输出、参考值、行 metadata、tags、error、origin、`scores` map 和可选 classifications。
`returnResults: false` 只影响内存中的逐行结果，不影响准确的增量平均值。

### 5.3 Python `Eval()` 与 `EvalAsync()` 全量配置

```python
def Eval(
    name,
    data,
    task,
    scores=None,
    classifiers=None,
    experiment_name=None,
    trial_count=1,
    metadata=None,
    tags=None,
    is_public=False,
    update=False,
    reporter=None,
    timeout=None,
    max_concurrency=None,
    project_id=None,
    base_experiment_name=None,
    base_experiment_id=None,
    git_metadata_settings=None,
    repo_info=None,
    error_score_handler=None,
    description=None,
    summarize_scores=True,
    no_send_logs=False,
    parameters=None,
    on_start=None,
    stream=None,
    parent=None,
    state=None,
    enable_cache=True,
) -> EvalResultWithSummary: ...

async def EvalAsync(...same keyword set...) -> EvalResultWithSummary: ...
```

字段含义与 TypeScript 对应，以下差异不能机械翻译：[Python Eval 源码][BT-PY-EVAL]

| 差异 | Python 0.32.0 行为 |
| --- | --- |
| 等待方式 | `Eval()` 内部管理 event loop；已有 loop 使用 `await EvalAsync()` |
| `timeout` | 单位是秒，不是毫秒 |
| 取消 | 没有公开 `signal` 参数 |
| 逐行内存 | 没有 `return_results=False` 选项 |
| 判分前 flush | 没有 `flush_before_scoring` 参数 |
| scorer 类 | 可传类或实例；类会无参实例化 |
| scorer 调用 | 优先 `eval_async()`；普通同步函数在线程池执行 |
| 参数绑定 | 按 `input`、`output`、`expected`、`metadata`、`trace` 名称绑定 |
| 旧式绑定 | 参数名不匹配时仍按剩余参数顺序补位；源码计划下个 major 删除 |
| `EvalScorerArgs` 类型 | 类型类没写 `trace`，runner 实际会传 `trace` |
| `error_score_handler` | `Eval()` 会转发；`EvalAsync()` 0.32.0 接收后没有转发 |

Python `EvalCase` 是 `EvalCase(input, expected=None, metadata=None, tags=None, trial_count=None)`。
行级 `trial_count` 优先于全局值。
`EvalHooks` 提供 `metadata`、`expected`、`span`、`trial_index`、`tags`、`report_progress()` 和 `parameters`。
`meta()` 同样废弃。

已有 event loop 时，0.32.0 的 `Eval()` 会提示改用 `EvalAsync()`，并为兼容旧签名返回 `Task`。
`EvalAsync()` 的 `error_score_handler` 漏转发是固定源码事实，不应依赖它补错误分。

### 5.4 reporter、异常与 CI 语义

TypeScript：

```typescript
Reporter(name, {
  reportEval(evaluator, result, opts): Report | Promise<Report>,
  reportRun(reports): boolean | Promise<boolean>,
});
```

Python：

```python
Reporter(
    name,
    report_eval=lambda evaluator, result, verbose, jsonl: report,
    report_run=lambda results, verbose, jsonl: True,
)
```

`reportRun` / `report_run` 返回 `false` 才让 `bt eval` 以非零状态退出。
默认 reporter 只因 task error 失败；低 score、本地平均值下降或空分都不会自动失败。
`braintrustdata/eval-action@v2` 运行相同 eval，并在 PR 留言。[CI 指南][DOC-CI]给出官方流程。

TypeScript 设置 `returnResults: false` 后，默认 reporter 收到空的 `results`。
它也就看不到逐行 task error，不能继续承担这条默认失败检查；CI 应保留逐行结果或自定义汇报路径。

scorer 异常会放进行 metadata 的 `scorer_errors` map。
task 异常使该行不进入正常判分。
TypeScript 与 Python `Eval()` 只有显式传入默认错误分处理器，才会为未运行 scorer 补 0。
它们虽名为 default，却不会自动启用；Python `EvalAsync()` 还有上节所述的转发缺口。

本地 summary 对每个具名 score 取非空值的算术平均。
远端 summary 还可给出对照 experiment 的 diff、improvements 与 regressions。
平台分组 UI 对 score 支持 avg、max、min；对运行指标支持 sum、avg、min、max。
[实验比较][DOC-COMPARE]给出这些聚合选项。

### 5.5 AutoEvals 初始化、偏应用与执行模型

TypeScript 初始化面：

```typescript
init(options?: {
  client?: OpenAI;
  defaultModel?: string | {
    completion?: string;
    embedding?: string;
  };
}): void;

getDefaultModel(): string;
```

Python 初始化面：

```python
init(
    client=None,
    is_async=False,  # deprecated
    default_model: str | {
        "completion": str,
        "embedding": str,
    } | None = None,
) -> None

get_default_model() -> str
```

completion 默认为 `gpt-5-mini`，embedding 默认为 `text-embedding-ada-002`。
字符串形式只设置 completion，并把 embedding 重置为默认值。
对象形式只改写明确给出的键。[TS client][AE-OAI]与[Python client][AE-PY-OAI]定义了这些细节。

两端 `init()` 每次都会替换 client；省略 client 就会清除先前注入值。
TypeScript 把配置放在 `globalThis`，Python 使用 `ContextVar`。
TypeScript 进程内并发运行不同 client 配置时，作者要自行避免相互改写。

两端包根只导出 completion accessor。
embedding accessor 存在于内部 `oai` 模块，但不是 TypeScript 或 Python 包根导出。
作者应通过 `init()` 设置 embedding 默认值，不应依赖内部模块路径。

未注入 client 时，TypeScript 会构造 OpenAI client。
它优先采用显式 base URL，其次采用 `OPENAI_BASE_URL`，最后采用 Braintrust Gateway。
旧 auth 字段、Azure auth、Python `engine`、`api_key`、`base_url` 与 `is_async` 均已废弃或正在废弃。
新代码应传实际 client。

TypeScript 内建 scorer 是可调用函数，并带：

```typescript
scorer.partial(boundArgs): Scorer
```

Python 内建 scorer 是类或实例，并带：

```python
ScorerClass.partial(**bound_kwargs) -> type[Scorer]
```

两端都在求值调用时让新参数优先于预绑定参数。
TypeScript `partial()` 返回函数；Python 返回同名子类，所以可直接放进 `scores=[...]`。
[TS partial][AE-PARTIAL]与[Python partial][AE-PY-PARTIAL]给出合并顺序。

Python 的 `partial()` 只绑定求值方法的关键字参数，不会重新执行构造器。
若参数只在构造器读取，例如模型 client，应实例化 scorer，而不是用 `partial()` 配置它。

TypeScript scorer 是否同步由实现决定。
Python scorer 都提供 `.eval()`、`.eval_async()` 和 `__call__()`。
基类默认 `.eval_async()` 会直接调用同步算法，不会自动转移到线程池。
模型类分别实现真正的同步和异步 client 调用。

### 5.6 TypeScript `agentAssertionScorer`

```typescript
agentAssertionScorer<Input, Output, Expected, Metadata>(
  callback: (args: {
    input: Input;
    output: Output;
    expected?: Expected;
    metadata: Metadata | Record<string, unknown>;
    assert: AgentAssertionHelpers;
  }) => AgentAssertion[] | Promise<AgentAssertion[]>,
  options?: { name?: string },
): EvalScorer<Input, Output, Expected, Metadata>;
```

默认 score 名是 `assertions`。
score 是通过条数除以总条数；回调返回空数组时为 1。
metadata 含 `{ assertions: [{name, passed}], failed: string[] }`。
回调或 predicate matcher 的未处理异常遵循普通 scorer error 语义。
schema 校验异常会被转成该条断言失败，不会上升成 scorer error。
[断言源码][BT-TS-ASSERT]是完整行为依据。

| 断言函数 | signature | 成功条件 | 默认名称 |
| --- | --- | --- | --- |
| `equals` | `(actual, expected, name?)` | 数组与普通对象递归深等；键集合必须相同 | `equals` |
| `notEquals` | `(actual, expected, name?)` | 不满足上述深等 | `not equals` |
| `contains` | `(value, matcher, name?)` | matcher 是字符串或正则；检查子串或格式化值 | `contains` |
| `matches` | `(value, schema, name?)` | `safeParse`、`parse` 或 Standard Schema 校验成功 | `matches schema` |
| `calledTool` | `(toolName, options?, name?)` | trace 中存在匹配 tool call，或数量等于 `times` | `called tool <name>` |
| `notCalledTool` | `(toolName, name?)` | 没有观察到该 tool call | `did not call tool <name>` |
| `toolOrder` | `(toolNames, name?)` | 名称按相对顺序出现；允许插入其它调用 | `tool order` |
| `usedNoTools` | `(name?)` | 没有观察到 tool span | `used no tools` |
| `maxToolCalls` | `(max, name?)` | 观察到的 tool call 数不大于 `max` | `at most <max> tool calls` |

`calledTool` 的 `options` 是：

```typescript
{
  input?: AssertionMatcher;
  output?: AssertionMatcher;
  isError?: boolean;
  times?: number;
}
```

matcher 可为原始值、正则、predicate、数组或普通对象。
对象执行局部匹配；数组要求长度相同并逐项匹配。
`input` 与 `output` 即使显式为 `undefined` 也会参加匹配。
`isError` 比较 span 是否有 error；`times` 要求精确次数。

函数先从 span attributes/name 取得候选名。
候选名含 `/` 时直接采用；否则 metadata 中的 tool 名优先于候选名。
若还有 MCP server 名，会形成 `server/tool`。

它识别 `metadata.tool_name`、`metadata["gen_ai.tool.name"]`、`mcp.server` 和 `openai_codex.mcp.server`。
名称开头的 `tool:` 会被移除；tool 断言函数只读取 `type: "tool"` 的 spans。

trace 缺失时有非对称语义。
`calledTool` 与非空 `toolOrder` 会失败；`notCalledTool`、`usedNoTools` 和 `maxToolCalls` 会把观察数当 0，因此可能通过。
这不是 skip，也不会提示 instrumentation 缺失。

该函数只在 TypeScript SDK 导出。
Python 作者需写普通 trace scorer 才能表达同一检查。
源码没有 `@experimental` 标记，但滚动 TypeScript API 页的版本落后于 npm，因此应固定 `braintrust@3.27.0`。
[TypeScript API reference][DOC-TS-API]在观察日仍标示 3.8.0。

### 5.7 `wrapVitest`：相邻的断言入口

```typescript
wrapVitest(vitestMethods, {
  projectName?: string;
  projectId?: string;
  displaySummary?: boolean;
  onProgress?: (event) => void;
}): {
  test; it; expect; describe;
  beforeAll; afterAll; beforeEach; afterEach;
  logOutputs; logFeedback; getCurrentSpan; flushExperiment;
}
```

`projectId` 与 `projectName` 同时提供时以前者为准。
`displaySummary` 默认为 `true`；`onProgress` 未提供时不发 progress 回调。

增强后的 `test` 可接收：

```typescript
{
  input?: unknown;
  expected?: unknown;
  metadata?: Record<string, unknown>;
  tags?: string[];
  scorers?: ScorerFunction[];
  data?: Array<{ input; expected; metadata; tags }>;
  // 其余键交给 Vitest，例如 timeout、retry、fails
}
```

`describe` 创建一个带时间戳名称的 experiment；`data` 会展开为多个 Vitest case。
test 返回值成为 output，配置中的 scorer 在 test 后执行；scorer error 会被保存。
[Vitest 指南][DOC-VITEST]与[wrapper 源码][BT-TS-VITEST]给出该流程。

包装后的 `expect(value, message)` 只有在提供 `message` 时才把断言写成同名 0 或 1 score。
失败仍重新抛给 Vitest。
未命名 `expect(value)` 完全沿用 Vitest，不额外写 score。
因此它适合测试式作者体验，却不是 `Eval()` scorer 的别名。

`braintrust/vitest-evals-reporter` 是另一个适配器。
它读取第三方 `vitest-evals` 的 judge 与 assertion metadata，再写进 Braintrust。
本文不把第三方 package 的 API 当作 Braintrust Eval 契约。

### 5.8 `LLMClassifier` 与模型 Judge 工厂

TypeScript 高层工厂：

```typescript
LLMClassifierFromTemplate<RenderArgs>({
  name,
  promptTemplate,
  choiceScores,
  model?,
  useCoT?,
  temperature?,
  maxTokens?,
  reasoningEffort?,
  reasoningEnabled?,
  reasoningBudget?,
  useResponsesApi?,
}): Scorer<string, LLMClassifierArgs<RenderArgs>>;

LLMClassifierFromSpec(name, spec): Scorer;
LLMClassifierFromSpecFile(name, templateName): Scorer;
```

Python 高层类：

```python
LLMClassifier(
    name,
    prompt_template,
    choice_scores,
    model=None,
    use_cot=True,
    max_tokens=None,
    temperature=None,
    reasoning_effort=None,
    reasoning_enabled=None,
    reasoning_budget=None,
    use_responses_api=None,
    engine=None,
    api_key=None,
    base_url=None,
    client=None,
    **extra_render_args,
)

LLMClassifier.from_spec(name, spec, client=None, **kwargs)
LLMClassifier.from_spec_file(name, path, client=None, **kwargs)
```

| 配置 | 默认值与传递语义 |
| --- | --- |
| `name`、prompt、choice map | 必填；choice 必须能映射到数值 score |
| `model` | 省略时取 completion 默认值 `gpt-5-mini` |
| `useCoT` / `use_cot` | 默认 `true`；控制 prompt 后缀、tool schema 与 rationale |
| `temperature` | 默认不发送，交给模型端点 |
| `maxTokens` / `max_tokens` | 默认不发送；Python 显式值最少会被抬到 5，TypeScript 原样发送 |
| 三个 reasoning 字段 | 默认不发送；传入后转成 snake_case 请求字段 |
| `useResponsesApi` / `use_responses_api` | 默认不强制；`gpt-5` 开头的模型仍会自动走 Responses API |
| client | 省略时使用 `init()` 注入值，再按默认 client 规则创建 |

`ModelGradedSpec` 的字段是 `prompt`、`choice_scores`、可选 `model`、`use_cot`、`temperature` 与 `max_tokens`。
Python 还保留已废弃的 `engine`。
TypeScript `templates` 导出随包 YAML；Python `from_spec_file` 接收任意文件路径。
Python 会按 scorer name 缓存第一次读取的文件内容；同进程复用名称不会重新读取另一路径。
源码注释称 `kwargs` 可覆写 spec，但重复 model、CoT、temperature、token 或 engine 键会触发 Python 重复关键字错误。

默认 `useCoT` / `use_cot` 为 `true`，默认模型为 `gpt-5-mini`。
TypeScript 调用时的 model、CoT、token 与推理参数优先于工厂参数。
Python 的这些配置固定在实例构造时；求值时 kwargs 主要填模板变量。
Judge 通过强制 `select_choice` tool call 取一个 choice。
返回 metadata 至少可含 `choice` 与 `rationale`；关闭 CoT 时 rationale 可缺失。

模板可读取 `output`、`expected` 和任意 render args。
若模板引用下列名称并收到 trace，工厂才调用 `getThread()` / `get_thread()`：

| thread 变量 | 值 |
| --- | --- |
| `thread` | 去掉 system message 的对话文本 |
| `thread_with_system` | 保留 system message 的对话文本 |
| `thread_count` | 对话 message 数 |
| `first_message` | 第一条 message |
| `last_message` | 最后一条 message |
| `user_messages` | user message 集合 |
| `assistant_messages` | assistant message 集合 |
| `human_ai_pairs` | human / assistant 配对 |

Python 同步 `.eval()` 在已有 event loop 中不能等待 async `trace.get_thread()`，会要求改用 `.eval_async()`。
模型空响应、无 tool call、tool 名不对、JSON 无效、未知 choice 或 client 请求失败都会抛异常。
[TS LLM][AE-LLM]与[Python LLM][AE-PY-LLM]给出模板检测与错误分支。

TypeScript 低层函数是：

```typescript
OpenAIClassifier({
  output,
  expected?,
  name,
  model,
  messages,
  choiceScores,
  classificationTools,
  cache?,
  client?,
  temperature?,
  maxTokens?,
  reasoningEffort?,
  reasoningEnabled?,
  reasoningBudget?,
  useResponsesApi?,
  ...renderArgs
}): Promise<Score>

buildClassificationTools(
  useCoT: boolean,
  choiceStrings: string[],
): ChatCompletionTool[]
```

作者要自行提供 name、model、messages、choice map 与 tool schema。
该函数始终异步，返回一个 `Score`，错误分支与高层工厂相同。
`modelGradedSpecSchema` 可校验 TypeScript spec，`templates` 提供随包 YAML。

Python 低层 `OpenAILLMClassifier` 构造器采用同组 snake_case 字段，并提供 `.eval()` 与 `.eval_async()`。
`build_classification_tools(use_cot, choices)` 与 `ModelGradedSpec` 也公开。
一般作者仍应先选高层工厂。[TS LLM][AE-LLM]与[Python LLM][AE-PY-LLM]是固定清单。

### 5.9 十个 LLM / moderation scorer

九个 YAML Judge 共享上节配置。
TypeScript 直接调用函数或 `.partial()`；Python 实例调用 `.eval()` / `.eval_async()`，或把类放进 `Eval(scores=...)`。
每个 Judge 都会发网络请求，并把 choice 放进 metadata；启用 CoT 时还会放 rationale。
[模板文件][AE-TEMPLATES]固定了下表 choice 映射。

| scorer | 必需输入 | choice 到 score | 真实判断 |
| --- | --- | --- | --- |
| `Battle` | `output`, `expected`, `instructions` | Yes 1；No 0 | output 是否比 expected 更好完成同一 instructions |
| `ClosedQA` | `output`, `input`, `criteria` | Y 1；N 0 | submission 是否满足 criterion |
| `Humor` | `output` | Yes 1；No 0；Unsure 0.5 | 文本是否好笑 |
| `Factuality` | `output`, `input`, 可选 `expected` | A 0.4；B 0.6；C 1；D 0；E 1 | 与 expert 的事实关系 |
| `Possible` | `output`, `input` | A 0；B 1 | 声称无解，或提供了解法 |
| `Security` | `output` | Yes 0；No 1；Unsure 0.5 | 字符串是否恶意 |
| `Sql` | `output`, `expected`, `input` | Correct 1；Incorrect 0 | SQL 是否语义等价 |
| `Summary` | `output`, `expected`, `input` | A 0；B 1 | output 是否比 expected 更好概括 input |
| `Translation` | `output`, `expected`, `input`, `language` | Y 1；N 0 | 翻译含义、名词与时态是否等价 |
| `Moderation` | `output` | 通过 1；任一命中 0 | 调用 moderation API，而非 YAML Judge |

`ClosedQA.criteria` 在当前模板中一定会渲染。
TypeScript 类型也把它设为必填，所以不应采信旧清单中“可选”的描述。
`Factuality.expected` 在类型上可选；缺失时模板会得到空 expert，不等于 skip。

`Moderation` 的配置是 `threshold?` 与 client。
未设 threshold 时采用 API 的 `flagged`；设置后，只要任一 `category_scores` 大于 threshold 就得 0。
metadata 含 threshold 与所有 category scores。
[TS Moderation][AE-MODERATION]与[Python Moderation][AE-PY-MODERATION]给出严格大于语义。

TypeScript JSDoc 提到 `categories`，但 0.3.0 类型和实现都没有这个参数。
Python 构造器也没有它，不能据注释假定可筛选 moderation 类别。
九个 Judge 与 Moderation 在 TypeScript 都异步；Python 都有同步和异步请求入口。

### 5.10 八个 RAG scorer

TypeScript `context` 接受字符串或字符串数组，并统一以换行连接数组。
Python 前四个 context scorer 也会这样连接数组。
Python `Faithfulness` 与 `AnswerRelevancy` 则把收到的 context 直接交给模板；跨语言代码应预先连接成字符串。
TypeScript RAG completion 模型沿用 `getDefaultModel()`，因此默认为 `gpt-5-mini`。
Python 若没有显式 model 或 `init(default_model=...)`，RAG 专用默认值仍是 `gpt-5-nano`。
[TS RAG][AE-RAG]与[Python RAG][AE-PY-RAG]明确保留了这个语言差异。

| scorer | 必需输入 | 算法、默认值与结果 metadata |
| --- | --- | --- |
| `ContextEntityRecall` | `expected`, `context` | 两次抽实体，再用 `ListContains(allowExtraEntities=true)`；默认 pairwise 为 embedding；metadata 含两侧实体 |
| `ContextRelevancy` | `input`, `context` | Judge 摘出必要句；字符长度之和除以 context 长度并夹在 0..1；metadata 含句子 |
| `ContextRecall` | `input`, `expected`, `context` | 对 expected 的各 statement 判 attributed；取平均；空列表为 0；metadata 含 statements |
| `ContextPrecision` | `input`, `expected`, `context` | Judge 一次返回 verdict 0 或 1；metadata 含 reason 与 verdict |
| `Faithfulness` | `input`, `output`, `context` | 先拆 statement，再逐条判断 context 支持度；取 verdict 平均；metadata 含两轮中间值 |
| `AnswerRelevancy` | `input`, `output`, `context` | 默认生成 3 个反向问题，与 input 做 embedding 相似度；任一 noncommittal 为 0；metadata 含问题与相似度 |
| `AnswerSimilarity` | `output`, `expected` | TS 把 `expectedMin` 固定为 0 并重命名；Python 沿用 embedding 默认阈值与名称 |
| `AnswerCorrectness` | `input`, `output`, `expected` | TP / FP / FN 的 F1 与语义相似度加权；默认权重 0.75 / 0.25；metadata 含两部分 |

这些 scorer 的 `output` 字段仍存在于统一协议中。
四个 context scorer 只判断检索 context 与参考答案时，不会读取 output。
缺少表中必需值会抛异常，不会自动返回空分。

八个 TypeScript scorer 都返回 Promise。
Python 八个类都提供同步和异步入口；模型、JSON、schema 或网络失败会抛异常。

#### RAG 可配参数

| scorer | TypeScript | Python |
| --- | --- | --- |
| 使用 completion 的 RAG | `model`, `temperature`, `maxTokens`, `client` | `model`, `client`, `temperature`，以及已弃用的 `api_key` / `base_url` |
| `ContextEntityRecall` | `pairwiseScorer` | `pairwise_scorer` |
| `AnswerRelevancy` | `strictness=3`, `embeddingModel` | `strictness=3`, `temperature=0.5`, `embedding_model` |
| `AnswerSimilarity` | `model` 传给 embedding | 构造器 `model` 传给 embedding |
| `AnswerCorrectness` | `factualityWeight=.75`, `answerSimilarityWeight=.25`, `answerSimilarity`, `embeddingModel` | snake_case 同义字段与自定义 scorer |

Python 只有 `ContextEntityRecall` 会读取 `pairwise_scorer`。
`ContextRelevancy`、`ContextRecall`、`ContextPrecision`、`AnswerSimilarity` 与 `AnswerCorrectness` 的构造器也接受它，但 0.3.0 没有使用。

`strictness` 实际是生成问题次数，应使用正整数。
Python docstring 把它写成 0..1 浮点严格度，但源码用 `range(strictness)`；这是文档漂移。
值为 0 时，TypeScript 得到 `NaN`，Python 会除零；Python 浮点值还会让 `range()` 抛错。

权重不可为负，也不可同时为 0。
`answerSimilarityWeight` 为 0 时不调用 embedding。
两部分按权重和归一化，不要求权重相加等于 1。

#### 已确认的跨语言边角

- TypeScript `Faithfulness` 在 Judge 返回零条 statement 时给 0。
  Python 直接除以列表长度，会抛 `ZeroDivisionError`。

- 空字符串会通过两端的必填检查。
  `ContextRelevancy` 遇到空 context 时，Python 会除零；TypeScript 会得到 `NaN` 或夹成 1。
  `AnswerCorrectness` 遇到 TP、FP、FN 都为空时，Python 会除零，TypeScript 会得到 `NaN`。

- Python `AnswerSimilarity` 直接返回内部 `EmbeddingSimilarity` 的对象。
  因此名称是 `EmbeddingSimilarity`，`expected_min` 仍为 0.7。
  TypeScript 则把下限设为 0，并把名称改成 `AnswerSimilarity`。
  默认 `AnswerCorrectness` 的语义相似度分量也会因此跨语言缩放不同。

- TypeScript `AnswerCorrectness` 通过 `Promise.all` 并发跑 factuality 与相似度。
  Python async 版先等待 factuality，再等待已创建但尚未执行的相似度 coroutine。
  两者名字相同，但单行延迟不同。

- 自定义 `answerSimilarity` 返回具名空分时，两端也不一致。
  TypeScript 用 `?? 0` 把空分折成 0；Python 会在权重乘法处因 `None` 抛 `TypeError`。

- TypeScript 每次调用传入的 client 不会自动进入两个嵌套 embedding。
  受影响的是 `ContextEntityRecall` 的默认 pairwise scorer，以及 `AnswerCorrectness` 的默认相似度 scorer。
  应通过 `init()` 配置，或传入已经绑定 client 的 `pairwiseScorer` / `answerSimilarity`；Python 构造器会向内传 client。

- TypeScript RAG 参数类型继承了推理字段，但 `parseArgs()` 只转发 model、temperature 与 max tokens。
  不应据类型猜测 `reasoningEffort` 会到达这八个 scorer 的请求。

### 5.11 七个确定性、embedding 与组合 scorer

| scorer | signature / 配置 | score 规则 | 执行与失败 |
| --- | --- | --- | --- |
| `ExactMatch` | `output`, 可选 `expected` | 值转字符串；对象与数组先 JSON 序列化；完全相同为 1 | 同步；不因 expected 缺失抛错 |
| `Levenshtein` | `output`, 必需 `expected` | `1 - distance / maxLength`；两个空串为 1 | 同步；缺 expected 抛错 |
| `NumericDiff` | 数值 `output`, 必需 `expected` | 两个 0 为 1，否则 `1 - abs(e-o)/(abs(e)+abs(o))` | TS 声明 async；Python 同步；缺 expected 抛错 |
| `EmbeddingSimilarity` | `prefix=""`, `expectedMin=.7`, embedding model、client | cosine 先减阈值再线性缩放并夹在 0..1 | TS 并发请求两次；Python 逐次等待；缺 expected 或网络失败抛错 |
| `JSONDiff` | `stringScorer=Levenshtein`, `numberScorer=NumericDiff`, `preserveStrings=false` | 对象按键并集平均；数组按下标并除以较长长度；叶子委托子 scorer | TS async；Python 主算法同步 |
| `ValidJSON` | `output`, 可选 JSON Schema | 对象或数组为 1；带 schema 时校验通过为 1；scalar JSON 在无 schema 时为 0 | JSON 无效或数据不符为 0；无效 schema 可抛错 |
| `ListContains` | list `output`, 必需 list `expected`, `pairwiseScorer=Levenshtein`, `allowExtraEntities=false` | pairwise 后做最优一对一指派；按较长长度归一；允许额外项时除以 expected 长度 | 空 / 空为 1；单边空为 0；pairwise 空分按 0；Python 需 `autoevals[scipy]` |

[TS 基础 scorer][AE-BASE]与[Python 基础 scorer][AE-PY-BASE]给出所有公式与默认值。
`LevenshteinScorer` 只是 `Levenshtein` 的兼容别名。

TypeScript embedding 若 cosine 库返回 `null`，会给 0 并写已废弃的 `Score.error`，不会抛错。
对象键顺序会影响两端 `ExactMatch` 的 JSON 字符串，因此它不是对象语义深等。

`JSONDiff` 在 `preserveStrings=false` 时会尝试解码看似有效的 JSON 字符串。
不同类型最终会做排序键的 JSON 字符串比较。
子 scorer 返回空分时，该叶子从对象平均中移除；数组的分母仍是较长数组长度。

TypeScript `JSONDiff` 可等待 async 子 scorer。
Python 的 `.eval_async()` 最终直接运行同步 `json_diff()`，而内部调用子 scorer 的 `.eval()`。
因此 Python 不适合把只提供 async client 的 scorer 直接传给 `JSONDiff`。

Python 0.3.0 的 `ValidJSON(schema=...)` 构造器保存了 schema，但 `_run_eval_sync()` 只读取调用时 `schema`。
也就是说，构造器 schema 在该快照里不会生效；应在 `.eval(output, schema=schema)` 传入。
TypeScript `.partial({schema})` 没有这个问题。[Python JSON 源码][AE-PY-JSON]显示了该缺陷。

### 5.12 公开清单、兼容名与缺口

本快照可调用的内建 scorer 总数是 25：十个 LLM / moderation、八个 RAG、七个基础或组合 scorer。
没有一个官方索引完整列出 25 个。

- `Evaluators` manifest 有 `Possible`，却漏掉 `Faithfulness`。
- `SCORERS.md` 有 `Faithfulness`，却漏掉 `Possible`。
- README 宣称有 BLEU 一类统计方法，但 0.3.0 没有导出 BLEU scorer。

因此本文按实际导出和源码实现盘点，不从营销分类推断 API。
[manifest][AE-MANIFEST]、[scorer 文档][AE-SCORERS]与[README][AE-ROOT]可交叉核对。

已废弃或低层入口如下：

| API | 状态与替代 |
| --- | --- |
| `LevenshteinScorer` | 兼容别名；新代码用 `Levenshtein` |
| `DEFAULT_MODEL` | 已废弃；用 `init(defaultModel=...)` / `init(default_model=...)` |
| `Score.error` | 已废弃；抛异常 |
| TS `openAiApiKey`、base URL、organization、Azure auth 字段 | 已废弃；传 `client` |
| Python `engine`、`api_key`、`base_url`、`is_async` | 已废弃；传实际 client |
| `OpenAIClassifier` / `OpenAILLMClassifier` | 公开低层件；一般作者用 `LLMClassifier*` |
| `ProgressReporter` | TypeScript 源码称旧式接口，未来可能移除 |

`templates`、`Evaluators`、`makePartial`、thread 格式化函数也从 TypeScript 顶层导出。
它们是组装与发现工具，不会增加新的 score 算法。

## 6. 四个可抄场景

### 6.1 确定性契约：三个断言合成一个 score

本例使用 TypeScript-only `agentAssertionScorer`，不调用模型。
在第 3 节项目中再安装 schema 依赖：

```bash
pnpm add zod
```

把下面内容保存为 `contract.eval.ts`：

```typescript
import { Eval, agentAssertionScorer } from "braintrust";
import { z } from "zod";

type Input = { ticket: string };
type Output = {
  status: "accepted" | "rejected";
  message: string;
};

const outputSchema = z.object({
  status: z.enum(["accepted", "rejected"]),
  message: z.string().min(1),
});

const contractScore = agentAssertionScorer<Input, Output, Output>(
  ({ output, expected, assert }) => [
    assert.equals(output.status, expected?.status, "status matches"),
    assert.contains(output.message, /ticket/i, "mentions ticket"),
    assert.matches(output, outputSchema, "valid output shape"),
  ],
  { name: "response contract" },
);

Eval("support-contract", {
  experimentName: "deterministic-contract",
  data: [
    {
      input: { ticket: "T-100" },
      expected: {
        status: "accepted",
        message: "Ticket T-100 was accepted",
      },
    },
  ],
  task: ({ ticket }) => ({
    status: "accepted" as const,
    message: `Ticket ${ticket} was accepted`,
  }),
  scores: [contractScore],
});
```

执行：

```bash
pnpm exec bt eval --no-send-logs contract.eval.ts
```

三条都通过时，`response contract` 为 1。
若一条失败则为 `2 / 3`，scorer 仍会生成逐条名称与失败原因 metadata。
本地 `EvalResult` 只留数值；去掉 `--no-send-logs` 后可在 scorer span 查看 metadata。
这个行为来自[断言源码][BT-TS-ASSERT]，不是 Vitest 的 pass / fail 状态。

### 6.2 开放 Judge：Python `LLMClassifier`

本例让 Judge 在“完整、部分、不足”中选一个标签。
它会调用模型并产生费用；先设置 `BRAINTRUST_API_KEY`，或改用自己的 OpenAI-compatible client。

进入第 3 节建立的 `.venv` 后安装 client：

```bash
python -m pip install openai
```

把下面内容保存为 `eval_open_judge.py`：

```python
import asyncio
import os

from autoevals import LLMClassifier, init
from braintrust import EvalAsync
from openai import AsyncOpenAI


client = AsyncOpenAI(
    api_key=os.environ["BRAINTRUST_API_KEY"],
    base_url=os.getenv("BRAINTRUST_AI_GATEWAY_URL")
    or "https://gateway.braintrust.dev",
)
init(client=client, default_model="gpt-5-mini")

helpfulness = LLMClassifier(
    name="Helpfulness",
    prompt_template="""
Question: {{input}}
Reference facts: {{expected}}
Assistant response: {{output}}

Choose Complete when the response directly answers the question with all
reference facts. Choose Partial when it is useful but incomplete. Choose
Insufficient when it does not answer the question.
""",
    choice_scores={
        "Complete": 1.0,
        "Partial": 0.5,
        "Insufficient": 0.0,
    },
    use_cot=True,
)


async def main():
    result = await EvalAsync(
        "open-judge-guide",
        experiment_name="helpfulness-local",
        data=[
            {
                "input": "Why do leaves look green?",
                "expected": "Chlorophyll absorbs red and blue light and reflects green light.",
            }
        ],
        task=lambda input: (
            "Leaves look green because chlorophyll reflects more green light "
            "than the red and blue light it absorbs."
        ),
        scores=[helpfulness],
        no_send_logs=True,
    )
    print(result.results[0].scores)


asyncio.run(main())
```

执行：

```bash
python eval_open_judge.py
```

输出 score 是 choice map 中的 1、0.5 或 0。
scorer 返回的模型选择与 rationale 只会被 runner 写到 scorer span，不会复制进 `EvalResult.scores`。
本地 no-send 路径没有持久 span，因此例中只能看到数值；去掉 `no_send_logs=True` 后可在平台展开诊断。
[Python LLM 源码][AE-PY-LLM]给出强制 tool choice 与 metadata 形状。

### 6.3 RAG 组合：两个维度与一个加权 scorer

本例同时检查 grounding 与参考答案正确性。
`AnswerCorrectness` 自身又把 factuality F1 和 embedding 相似度加权。
`trialCount: 3` 展示按相同 input 分组的重复执行。
它会调用 completion 与 embedding 端点并产生费用，执行前要设置 `BRAINTRUST_API_KEY`。

把下面内容保存为 `rag.eval.ts`：

```typescript
import { Eval, type EvalScorer } from "braintrust";
import {
  AnswerCorrectness,
  Faithfulness,
  init,
} from "autoevals";
import OpenAI from "openai";

type RowMetadata = { context: string[] };

init({
  client: new OpenAI({
    apiKey: process.env.BRAINTRUST_API_KEY,
    baseURL:
      process.env.BRAINTRUST_AI_GATEWAY_URL ??
      "https://gateway.braintrust.dev",
  }),
  defaultModel: {
    completion: "gpt-5-mini",
    embedding: "text-embedding-3-small",
  },
});

const grounded: EvalScorer<
  string,
  string,
  string,
  RowMetadata
> = ({ input, output, metadata }) =>
  Faithfulness({
    input,
    output,
    context: metadata.context,
  });

const correct = AnswerCorrectness.partial({
  factualityWeight: 0.8,
  answerSimilarityWeight: 0.2,
  embeddingModel: "text-embedding-3-small",
});

Eval("rag-guide", {
  experimentName: "rag-composition",
  data: [
    {
      input: "What is the capital of France?",
      expected: "Paris is the capital of France.",
      metadata: {
        context: [
          "Paris is the capital of France.",
          "France is a country in Western Europe.",
        ],
      },
    },
  ],
  task: () => "Paris is France's capital.",
  scores: [grounded, correct],
  trialCount: 3,
});
```

安装缺少的 client 并执行：

```bash
pnpm add openai
pnpm exec bt eval --no-send-logs rag.eval.ts
```

每个 trial 得到 `Faithfulness` 与 `AnswerCorrectness` 两列。
本地 summary 分别对三次非空值取平均，不会再把两列合成一个总分。
平台可按 input 收起 trials 并显示组统计。[实验比较][DOC-COMPARE]说明 trial 视图。

### 6.4 异步数据、流式 task 与 trace scorer

本例用 async generator 供数，并消费 OpenAI stream 后再让 scorer 看最终文本。
`wrapOpenAI` 产生 LLM span，trace scorer 据此检查调用预算。
它会产生模型费用，执行前要设置 `BRAINTRUST_API_KEY`。

把下面内容保存为 `stream-trace.eval.ts`：

```typescript
import {
  Eval,
  wrapOpenAI,
  type EvalScorer,
} from "braintrust";
import { ExactMatch } from "autoevals";
import OpenAI from "openai";

const client = wrapOpenAI(
  new OpenAI({
    apiKey: process.env.BRAINTRUST_API_KEY,
    baseURL:
      process.env.BRAINTRUST_AI_GATEWAY_URL ??
      "https://gateway.braintrust.dev",
  }),
);

async function* cases() {
  yield { input: "Reply with exactly: Paris", expected: "Paris" };
}

async function task(input: string): Promise<string> {
  const stream = await client.chat.completions.create({
    model: "gpt-5-mini",
    messages: [{ role: "user", content: input }],
    stream: true,
  });

  let output = "";
  for await (const chunk of stream) {
    output += chunk.choices[0]?.delta.content ?? "";
  }
  return output;
}

const oneLlmCall: EvalScorer<string, string, string> = async ({ trace }) => {
  if (!trace) {
    return { name: "one LLM call", score: null };
  }
  const llmSpans = await trace.getSpans({ spanType: ["llm"] });
  return {
    name: "one LLM call",
    score: llmSpans.length === 1 ? 1 : 0,
    metadata: { llmCalls: llmSpans.length },
  };
};

Eval("stream-trace-guide", {
  data: cases(),
  task,
  scores: [ExactMatch, oneLlmCall],
  flushBeforeScoring: true,
});
```

执行：

```bash
pnpm exec bt eval stream-trace.eval.ts
```

这里的流在 task 内被消费，scorer 收到最终字符串。
本例需要上传 experiment，才能让包装 client 的 spans 成为 trace scorer 的稳定输入。
若改为 Braintrust 远端 function，可用 `invoke({ stream: true, ... })`，再等待 `finalValue()`。
直接把 stream 对象当 output 返回，只会让 scorer 看到对象，不会由 Eval 自动合并 token。

## 7. 结果、诊断、artifact、CI 与 re-score

### 7.1 单行结果与 scorer span

experiment 表默认一行是一条 root trace。
切到 spans 视图后，可查看 task、LLM、tool、score 与 classifier spans。
展开 trace 可见 input、output、expected、metadata、参数、耗时、token、score 与解释。
[结果解释][DOC-RESULTS]列出了这些字段。

常见诊断位置：

| 现象 | 查哪里 | 保留了什么 |
| --- | --- | --- |
| task 抛错 | root eval span 的 error | 异常与 stack；该行 scorer 通常未运行 |
| scorer 抛错 | 行 metadata 的 `scorer_errors`；对应 score span | scorer 名和异常文本 |
| Judge 低分 | scorer span metadata | choice 与 rationale |
| RAG 低分 | scorer span metadata | statements、实体、问题、配对或子分 |
| assertion 低分 | scorer span metadata | 每条 name / passed 与失败消息 |
| classifier 结果 | `classifications.<name>` 列 | id、label 与 metadata |

`EvalResult.scores` 只是一张 `name -> number | null` 表。
需要 rationale 或中间计算时，应看 scorer span，而不是期待它被复制到逐行结果对象。

### 7.2 汇总、比较与 trial

本地模式对每个 score 列做非空算术平均。
远端 `experiment.summarize()` / `summarize()` 可返回 score、diff、improvements 与 regressions。
比较默认按 input 对齐，也可在平台选择其它 comparison key。

平台 Summary 与 Summary table 可切换聚合。
score 有 avg、max、min；运行指标还有 sum。
“All scores avg”会平均非 pairwise score 列，这与单列按行平均是两个层次。
trial 先保留为独立行，再可按 input 分组查看组统计。[实验比较][DOC-COMPARE]给出精确定义。

### 7.3 artifact 的真实边界

`Score` 没有 artifact 字段，只有 JSON-serializable metadata。
不能把大文件、二进制内容或下载引用伪装成通用 score artifact 契约。

Braintrust 日志事件可在任意字段放 `Attachment`，平台会上传并提供预览或下载。
scorer 也可从输入读取只读 attachment。
这属于 trace / log 协议，不是 AutoEvals `Score` 返回面。[附件指南][DOC-ATTACH]说明生命周期。

**研究判断。** 若 scorer 产生大诊断文件，应先把它作为受支持的 attachment 写入 span，再把稳定 ID 或摘要放在 score metadata。
本文没有找到“从 Score 自动上传 artifact”的官方 API。

### 7.4 CI gate

官方通用命令是：

```bash
BRAINTRUST_API_KEY="$BRAINTRUST_API_KEY" \
  bt eval evals/ --no-input --json
```

`--first N` 与 `--sample N` 产生 non-final run，适合 PR smoke；完整数据集用于 merge。
GitHub Actions 官方入口是 `braintrustdata/eval-action@v2`。

默认退出码只看异常。
要把平均值、对照退步或空分变成 gate，应写 `Reporter`，在 `reportRun` 中返回布尔值。
不要把 scorer 的 `__pass_threshold` UI 标记误当 CLI gate。[CI 指南][DOC-CI]明确要求 reporter。

### 7.5 re-score，而非重跑 task

平台支持对现有 experiment 行追溯判分：

1. 多行：勾选行后点 Score，选择 scorer 或 classifier。
2. 单行：打开 trace 后点 Score。
3. Scorer UI：拿手工输入、dataset 或 logs 独立试 scorer。

新增结果以额外 score / classifier span 写回 trace，不重新执行原 task。
Playground 的 Run row 则会同时重跑 task 与全部 scorer。
[结果解释][DOC-RESULTS]与[重跑说明][DOC-RESCORE]区分了这两类动作。

### 7.6 在线判分与反馈

在线 rule 在后台异步处理生产 traces，不增加应用请求路径的等待时间。
rule 可设 filter、sampling rate、scorer 与 scope。
scope 有 span、trace 和 group；group 可跨多条 trace，行级 input / output 不再代表整个组。
[在线判分][DOC-ONLINE]定义了这些边界。

保存 scorer 的 metadata 可放 `__pass_threshold: number`。
平台据此显示 pass / fail；这不会改变 score，也不会自动改变 `bt eval` 退出码。
[阈值说明][DOC-THRESHOLD]给出该 magic key。

SDK 的 `logFeedback` / `log_feedback` 可给既有 span 添加 `scores`、corrected `expected`、comment、metadata、tags 与 source。
source 是 `app`、`api` 或 `external`，默认 `external`。
至少要给 scores、expected、tags 或 comment 中的一项。
[反馈指南][DOC-FEEDBACK]给出用户反馈流程；[logger 源码][BT-FEEDBACK]给出参数校验。

Human review 可用连续 0..1 slider、离散类别、corrected output 与 comment。
多条同名 feedback 在父行显示时会聚合，因此人工 score 也不是一个不可变断言事实。
[人工 review][DOC-HUMAN]说明 review queue 与字段。

## 8. 自定义扩展

### 8.1 inline scorer

最小 TypeScript 自定义 scorer：

```typescript
import type { EvalScorer } from "braintrust";

const hasCitation: EvalScorer<string, string, string> = ({ output }) => ({
  name: "has citation",
  score: /\[[0-9]+\]/.test(output) ? 1 : 0,
  metadata: { pattern: "[n]" },
});
```

一个调用可返回多列：

```typescript
const formatChecks = ({ output }: { output: string }) => [
  { name: "non-empty", score: output.trim() ? 1 : 0 },
  { name: "under 80 chars", score: output.length <= 80 ? 1 : 0 },
];
```

Python 函数可返回数字、`None`、`Score`、合法 dict 或 `ScoreLike` sequence。
需要可复用类时，继承 `Scorer`，实现 `_run_eval_sync()`，并按需覆写 `_run_eval_async()`。
需要 `.partial()` 时继承 `ScorerWithPartial`。[自定义 scorer 指南][DOC-CUSTOM]给出 inline 形状。

### 8.2 保存并推送 scorer

先建立项目定义容器：

```typescript
import { projects } from "braintrust";
const project = projects.create({ name: "my-project" });
```

Python 对应：

```python
from braintrust import projects

project = projects.create("my-project")
```

TypeScript code scorer：

```typescript
project.scorers.create({
  name?, slug?, description?, ifExists?, metadata?, tags?,
  handler,
  parameters?,
  returns?,
});
```

TypeScript LLM scorer：

```typescript
project.scorers.create({
  name?, slug?, description?, ifExists?, metadata?, tags?,
  prompt? | messages?,
  model,
  params?,
  useCot,
  choiceScores,
  templateFormat?,
});
```

Python code scorer 要求 `handler` 与 Pydantic `parameters`，`returns` 可选。
Python LLM scorer 要求 prompt 或 messages、model、`use_cot` 与 `choice_scores`，`params` 可选。
两端还支持 name、slug、description、if-exists、metadata 与 tags。
[function builder 源码][BT-TS-FN] [BT-PY-FN]给出 overload。

TypeScript `project.scorers.create()` 只登记定义并返回 `void`。
Python 会返回 `CodeFunction` 或 `CodePrompt`；这些返回值不是一次判分结果。
省略 name 时，两端会从 handler 名生成名称，否则使用递增的备用名；slug 默认由名称生成。

保存的 classifier 走 `project.classifiers.create(...)`。
它是 code handler，配置字段与 code scorer 相同，返回 `Classification` 或数组。
LLM classifier 也可在 UI 创建，模型必须支持 streaming 与 tool use。
[Judge 指南][DOC-JUDGE]说明 label、无匹配选项与 trace scope。

推送命令：

```bash
bt functions push my_scorers.ts
bt functions push my_scorers.py
```

函数按 slug 自动版本化。
`ifExists` / `if_exists` 可取 `error`、`replace`、`ignore`。
省略时，`bt functions push` 默认采用 `error`。
[函数部署指南][DOC-DEPLOY]给出当前命令；builder 源码给出三值枚举。

### 8.3 在 Eval 中复用保存的 scorer

TypeScript：

```typescript
const scorer = initFunction({
  projectName: "my-project",
  slug: "my-scorer",
  version: "optional-version",
});
```

Python：

```python
scorer = init_function(
    project_name="my-project",
    slug="my-scorer",
    version="optional-version",
)
```

省略 version 会用 latest。
返回函数可直接放入 task 或 scores。
远端函数 spans 不在本地 span cache，所以 `initFunction()` 与 `init_function()` 会关闭该 cache。
[TS invoke][BT-INVOKE]与[Python invoke][BT-PY-INVOKE]说明这个副作用。

也可直接调用平台的 global scorer：

```typescript
const score = await invoke({
  globalFunction: "Factuality",
  functionType: "scorer",
  input: { input, output, expected },
});
```

global function 是平台托管版本。
不要仅凭名称假定它与本地 `autoevals@0.3.0` 的模板、模型或 commit 相同。

### 8.4 trace 自定义面

inline trace scorer 直接在参数中声明 `trace`。

```typescript
const scorer = async ({ trace }) => {
  if (!trace) return null;
  const spans = await trace.getSpans({ spanType: ["llm", "tool"] });
  const thread = await trace.getThread();
  return { name: "trace check", score: spans.length > 0 ? 1 : 0 };
};
```

Python 对应 `await trace.get_spans(span_type=["llm", "tool"])` 与 `await trace.get_thread()`。
span 可提供 input、output、expected、metadata、tags、scores、metrics、error、span ID、parents 与 attributes。
trace scorer 每条 trace 执行一次。[自定义 scorer 指南][DOC-CUSTOM]列出字段和最低 SDK 版本。

## 9. 好在哪里

**研究判断。** 最强的设计是 scorer 与应用代码都只是函数。
同一个 AutoEvals scorer 可单独调用、预绑定、放进 `Eval()`、保存到平台，或用于在线 rule。
迁移成本主要是参数映射，不是重写算法。

`Score(name, score, metadata)` 很小，却足以承载 choice、rationale、配对、statement 与子分。
多 score 返回还能让一次昂贵 Judge 调用生成多个独立列。
这比把解释混入一个字符串结果更利于平台过滤。

`partial()` 的语法适合把稳定 rubric 与每行动态值分开。
例如 `AnswerCorrectness.partial({ factualityWeight: 0.8 })` 可直接成为具名 scorer。
运行时参数仍能覆写预绑定值，便于实验参数化。

trace 被作为 scorer 的显式只读输入，而不是全局查询。
`getSpans()` 与 `getThread()` 能把轨迹、工具预算和多轮质量纳入同一 Eval。
`flushBeforeScoring` 又让 span 可见性成为可配置项。

`agentAssertionScorer` 把输出断言、schema 与 tool 轨迹检查压进很短的数组语法。
每条断言仍有名称和失败消息，最终 score 又能参加普通汇总。
对“多个检查共同衡量一次 agent 执行”尤其顺手。

本地 `--no-send-logs` 与远端 experiment 使用同一 task / scorer 文件。
作者可先无登录验证确定性逻辑，再上传有价值的运行。
平台随后提供 trace drill-down、比较、人工 review、在线 rule 和追溯判分。

## 10. 不好的地方与不应类比 NiceEval 的边界

**研究判断。** `LLMClassifier` 返回数值 Score，而 `Eval.classifiers` 返回非数值 Classification。
同一个词横跨两种协议，初学者很容易把 choice map Judge 与平台分类列混为一谈。

低分不是失败，pass threshold 也不是 CLI gate。
若作者把 `score: 0` 当断言失败，却没写 reporter，CI 仍可能成功。
这是“评估度量”与“测试裁定”之间最重要的边界。

TypeScript 顶层 `null` 与 Python 顶层 `None` 的行为不同。
一个省略 score，另一个写具名空分。
跨语言实现若只看类型别名，很难预测 experiment 列形状。

`agentAssertionScorer` 把 N 条断言折成一列。
它不保留独立测试身份、独立 retry 或每条独立聚合。
更危险的是，缺 trace 时三个负向 tool 断言会把“没有观察到”当通过。

AutoEvals 的公开发现面不一致。
manifest 与 `SCORERS.md` 各漏一个 scorer，README 又提到未导出的 BLEU。
Python RAG 的默认模型、`AnswerSimilarity` 名称和部分 docstring 也与 TypeScript 不同。

模型 Judge 的标签映射很清楚，但 rubric 稳定性、模型漂移和人类校准不由 API 保证。
`useCoT=true` 只要求模型返回 reasoning，不会自动证明 Judge 更可靠。
choice score 的离散值也不等于统计置信度。

RAG scorer 是具体算法，不是抽象真理。
例如 `ContextRelevancy` 用字符长度比，`AnswerCorrectness` 用固定 F1 与 embedding 加权。
把这些名字直接类比为 NiceEval 的产品级契约，会隐藏算法假设。

`Score.metadata` 只能放 JSON 诊断，不能直接承载 artifact。
大诊断依赖 trace attachment，离开 Braintrust 平台后需要作者自行保留关联。

本地汇总固定为非空算术平均；平台 UI 又能换 avg、max、min。
同一个“总览数字”可能来自不同层次和聚合设置，引用时必须写清列、分组与算法。

## 11. 对 NiceEval 可吸收与不应复制

以下都是研究判断，不是 NiceEval 已定契约。

| 可吸收 | 原因 |
| --- | --- |
| `input` / `output` / `expected` / `metadata` 的小 scorer 协议 | 普通函数容易单测、组合与跨运行器复用 |
| 结构化 score metadata | rationale、子分和匹配细节可被 UI 展开，而不污染数值 |
| 多 score 返回 | 一次昂贵调用可贡献多条具名观察 |
| 显式 trace 输入 | 轨迹检查不必通过全局日志反查 |
| `partial()` 式配置 | 把稳定 rubric 与每例数据分开，语法短 |
| 本地执行与远端保存共用定义 | 降低从调试到实验比较的切换成本 |
| scorer-only 追溯执行 | 修 Judge 时不必重新付 task 成本 |
| classifier 与 score 分栏 | 离散标签不应伪装成连续质量值 |
| reporter 承担 CI 策略 | 判分与团队 gate 可以分离，但必须显式 |

| 不应复制 | 原因 |
| --- | --- |
| `LLMClassifier` 与 classifier 同名异义 | 名称应直接暴露是数值 Judge 还是离散分类 |
| 顶层空值的跨语言分歧 | skip、无分与省略列应是显式且一致的代数 |
| 缺 trace 时负向断言通过 | instrumentation 缺失应与“确实没有调用”分开 |
| N 条断言只剩一列比例 | 逐条身份、证据、严重度与总览都应保留 |
| 名为 default 却不自动启用的 error handler | 默认行为与 opt-in 处理器的命名应一致 |
| magic metadata `__pass_threshold` | gate 与显示阈值应有公开类型和独立语义 |
| 多份不一致的 scorer 清单 | 公开 catalog 应由导出或 schema 单一生成 |
| 随语言漂移的模型和名称 | 同名 scorer 应固定算法版本、默认值与结果名 |
| 诊断只在平台 span 中完整可见 | 本地运行也应拿到同等结构化证据 |

## 12. 无法核实项

1. 官方发布页没有把 npm / PyPI artifact 映射到 Git commit。
   本文确认仓库版本字段相同，但不能证明 registry tarball 的逐字内容就是所列 commit。

2. 滚动 TypeScript API reference 的展示版本落后于 3.27.0。
   `agentAssertionScorer` 已在 3.27.0 源码和 scorer 指南出现，但没有单独的引入版本公告。

3. 平台 global scorer 的实际 AutoEvals commit、默认模型和更新节奏没有公开固定点。
   本文不把 `invoke(globalFunction="Factuality")` 等同本地 0.3.0。

4. 平台不同视图的初始聚合选择没有统一公开契约。
   可确认 score 支持 avg、max、min；不能把某个 UI 当时显示的选项写成永久默认。

5. 本次研究没有使用付费模型或 Braintrust 账号执行 Judge、上传、在线 rule、人工 review 与 re-score。
   相关流程按官方文档与固定源码核对，没有登录租户执行权限、费用或界面检查。

6. Python `ValidJSON` 构造器 schema、Python `Faithfulness` 空列表和 `AnswerSimilarity` 名称差异来自源码阅读。
   本次没有在发布 wheel 上执行这些边角，因此不能排除打包时存在未见补丁。

7. `Score` 没有 artifact 字段，attachment 属于日志协议。
   没有找到官方说明可保证任意 attachment ID 放进 score metadata 后会自动显示为可下载附件。

[AE-ROOT]: https://github.com/braintrustdata/autoevals/tree/b0e1055

[AE-TS-SCORE]: https://github.com/braintrustdata/autoevals/blob/b0e1055/js/score.ts

[AE-PY-SCORE]: https://github.com/braintrustdata/autoevals/blob/b0e1055/py/autoevals/score.py

[AE-LLM]: https://github.com/braintrustdata/autoevals/blob/b0e1055/js/llm.ts

[AE-PY-LLM]: https://github.com/braintrustdata/autoevals/blob/b0e1055/py/autoevals/llm.py

[AE-RAG]: https://github.com/braintrustdata/autoevals/blob/b0e1055/js/ragas.ts

[AE-PY-RAG]: https://github.com/braintrustdata/autoevals/blob/b0e1055/py/autoevals/ragas.py

[AE-BASE]: https://github.com/braintrustdata/autoevals/tree/b0e1055/js

[AE-PY-BASE]: https://github.com/braintrustdata/autoevals/tree/b0e1055/py/autoevals

[AE-MANIFEST]: https://github.com/braintrustdata/autoevals/blob/b0e1055/js/manifest.ts

[AE-OAI]: https://github.com/braintrustdata/autoevals/blob/b0e1055/js/oai.ts

[AE-PY-OAI]: https://github.com/braintrustdata/autoevals/blob/b0e1055/py/autoevals/oai.py

[AE-PARTIAL]: https://github.com/braintrustdata/autoevals/blob/b0e1055/js/partial.ts

[AE-PY-PARTIAL]: https://github.com/braintrustdata/autoevals/blob/b0e1055/py/autoevals/partial.py

[AE-TEMPLATES]: https://github.com/braintrustdata/autoevals/tree/b0e1055/templates

[AE-MODERATION]: https://github.com/braintrustdata/autoevals/blob/b0e1055/js/moderation.ts

[AE-PY-MODERATION]: https://github.com/braintrustdata/autoevals/blob/b0e1055/py/autoevals/moderation.py

[AE-PY-JSON]: https://github.com/braintrustdata/autoevals/blob/b0e1055/py/autoevals/json.py

[AE-SCORERS]: https://github.com/braintrustdata/autoevals/blob/b0e1055/SCORERS.md

[NPM-AE]: https://www.npmjs.com/package/autoevals/v/0.3.0

[PYPI-AE]: https://pypi.org/project/autoevals/0.3.0/

[BT-TS-ROOT]: https://github.com/braintrustdata/braintrust-sdk-javascript/tree/f790a3a

[BT-PY-ROOT]: https://github.com/braintrustdata/braintrust-sdk-python/tree/a82dc20

[BT-TS-EVAL]: https://github.com/braintrustdata/braintrust-sdk-javascript/blob/f790a3a/js/src/framework.ts

[BT-PY-EVAL]: https://github.com/braintrustdata/braintrust-sdk-python/blob/a82dc20/py/src/braintrust/framework.py

[BT-TS-ASSERT]: https://github.com/braintrustdata/braintrust-sdk-javascript/blob/f790a3a/js/src/agent-assertions.ts

[BT-TS-VITEST]: https://github.com/braintrustdata/braintrust-sdk-javascript/tree/f790a3a/js/src/wrappers/vitest

[BT-TS-FN]: https://github.com/braintrustdata/braintrust-sdk-javascript/blob/f790a3a/js/src/framework2.ts

[BT-PY-FN]: https://github.com/braintrustdata/braintrust-sdk-python/blob/a82dc20/py/src/braintrust/framework2.py

[BT-SCORE]: https://github.com/braintrustdata/braintrust-sdk-javascript/blob/f790a3a/js/util/score.ts

[BT-PY-SCORE]: https://github.com/braintrustdata/braintrust-sdk-python/blob/a82dc20/py/src/braintrust/score.py

[BT-STREAM]: https://github.com/braintrustdata/braintrust-sdk-javascript/blob/f790a3a/js/src/functions/stream.ts

[BT-PY-STREAM]: https://github.com/braintrustdata/braintrust-sdk-python/blob/a82dc20/py/src/braintrust/functions/stream.py

[BT-INVOKE]: https://github.com/braintrustdata/braintrust-sdk-javascript/blob/f790a3a/js/src/functions/invoke.ts

[BT-PY-INVOKE]: https://github.com/braintrustdata/braintrust-sdk-python/blob/a82dc20/py/src/braintrust/functions/invoke.py

[BT-FEEDBACK]: https://github.com/braintrustdata/braintrust-sdk-javascript/blob/f790a3a/js/src/logger.ts

[NPM-BT]: https://www.npmjs.com/package/braintrust/v/3.27.0

[PYPI-BT]: https://pypi.org/project/braintrust/0.32.0/

[DOC-RUN]: https://www.braintrust.dev/docs/evaluate/run-in-code

[DOC-AUTOEVALS]: https://www.braintrust.dev/docs/evaluate/autoevals

[DOC-CUSTOM]: https://www.braintrust.dev/docs/evaluate/custom-code

[DOC-JUDGE]: https://www.braintrust.dev/docs/evaluate/llm-as-a-judge

[DOC-RESULTS]: https://www.braintrust.dev/docs/evaluate/interpret-results

[DOC-COMPARE]: https://www.braintrust.dev/docs/evaluate/compare-experiments

[DOC-CI]: https://www.braintrust.dev/docs/evaluate/run-in-ci

[DOC-CLI]: https://www.braintrust.dev/docs/reference/cli/eval

[DOC-CLI-QUICK]: https://www.braintrust.dev/docs/reference/cli/quickstart

[DOC-TS-API]: https://www.braintrust.dev/docs/reference/sdks/typescript/3.8.0/typescript

[DOC-DEPLOY]: https://www.braintrust.dev/docs/deploy/functions

[DOC-ONLINE]: https://www.braintrust.dev/docs/evaluate/score-online

[DOC-FEEDBACK]: https://www.braintrust.dev/docs/instrument/user-feedback

[DOC-HUMAN]: https://www.braintrust.dev/docs/annotate/human-review

[DOC-RESCORE]: https://www.braintrust.dev/docs/kb/re-running-scorers-without-re-running-tasks

[DOC-THRESHOLD]: https://www.braintrust.dev/docs/kb/configure-scorer-pass-threshold-via-api

[DOC-ATTACH]: https://www.braintrust.dev/docs/instrument/attachments

[DOC-VITEST]: https://www.braintrust.dev/docs/integrations/sdk-integrations/vitest
