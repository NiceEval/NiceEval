# Judge —— Library

`niceeval/expect` 导出公开 `JudgeMaterial`，以及三个纯 managed `ScoreMatch<JudgeMaterial>` factory。它们只形成比较条件，不读取 ctx、
不绑定 subject、不登记，也不拥有自己的 AssertionHandle：

```ts
import {
  closedQA,
  factuality,
  summarizes,
  type JudgeMaterial,
} from "niceeval/expect";

const correctness = turn.check(
  { input: turn.input, output: turn.message },
  factuality("Brooklyn 的天气是晴朗。").atLeast(0.9),
)
  .gate()
  .label("天气事实");

const summary = t.check(
  { input: "请总结需求。", output: t.reply },
  summarizes("原始需求"),
).score(10).label("摘要质量");
```

上例的第一条属于 Pass Eval，第二条属于 Score Eval。Pass threshold 先由 `ScoreMatch.atLeast(n)` 形成，
无参 `gate()` 只决定这个局部 condition 是否进入 Verdict。Score measurement 可以不设 threshold，直接持久化 evaluation 或贡献 score。

```ts
export interface JudgeMaterial {
  readonly input: string;
  readonly output: string;
}

export declare function closedQA(question: string): ScoreMatch<JudgeMaterial>;
export declare function factuality(expected: string): ScoreMatch<JudgeMaterial>;
export declare function summarizes(source: string): ScoreMatch<JudgeMaterial>;
```

三者返回的 Match 都是不可变、managed 的作者值。`.atLeast(n)` 返回新的 `ThresholdedScoreMatch<JudgeMaterial>`；
它不修改 factory 结果。普通自定义 `ScoreMatch` 与 Judge Match 使用同一 `check` overload 和 handle policy。

## 原生 recipe protocol

NiceEval 为三个 recipe 直接拥有 rubric 与请求协议：

- `closedQA(question)` 只在 candidate 满足 question 时给出 `1`，否则给出 `0`；
- `factuality(expected)` 以 expected 为参考答案，完整一致为 `1`、矛盾为 `0`，部分正确或不完整可给中间值；
- `summarizes(source)` 以 source 为待总结原文，忠实且完整为 `1`、无关或矛盾为 `0`，其余可给中间值。

Runtime 把 rubric 放在可信 control channel。`JudgeMaterial.input`、`output` 与 recipe 的参考资料进入分隔的
untrusted data block。Provider 必须调用 `niceeval.llm-judge-decision/v1` 的唯一 decision tool。

返回值必须恰好包含有限 `[0,1]` measurement 与公开 rationale。缺少 tool call、额外字段、非法 JSON 或越界
measurement 都是 evaluator error，不会降格成 `0`。公开 rationale 进入既有 Assertion detail，不保存隐藏思维链。

## Capability 与配置

Eval 的 `judge` 字段声明 Judge capability：

```ts
defineEval({ judge: true, test });

defineEval({
  judge: { model: "judge-model", timeoutMs: 120_000 },
  test,
});
```

- `true` 从 Experiment 和项目 `defineConfig` 继承配置字段。
- 对象声明 capability，并按字段替换外层配置。
- 未声明时创建 Judge Assertion 是同步作者错误。

Runner 在规划时冻结一次求值后的配置。同一不可变值进入 fingerprint、预检与 evaluator；Record 只保存
credential selector，不保存 key。

## 材料边界

root、Session 与 Turn 都通过 `check` 接受显式结构化材料：

```ts
const source = await t.sandbox.readText("README.md");

t.check(
  { input: source, output: t.reply },
  closedQA("文档是否说明安装步骤？").atLeast(0.8),
).gate().label("安装说明");
```

Turn 新增只读 `input`，保存这次 `send` 已冻结的文本；既有只读 `message` 是 output。规范写法是
`turn.check({ input: turn.input, output: turn.message }, match)`。若 `send` 使用带 files 的对象形状，`turn.input`
仍只保存其中的 `text`。context 不暴露注册型 Judge recipe namespace，也不做路径猜测、隐式 last input 或单项 model override。

## 求值、控制与错误

`check` 对同一 entry 执行 Judge evaluation 一次。handle 可以跨 `await` 配置，但不重读材料或重启模型。
同一 Attempt 的 Judge evaluator 按 source order 进入受管 serial lane；Attempt 之间仍可并发。

thresholded measurement handle 可以 `await .orStop()`，Pass 下还提供无参 `.gate()` policy。below 触发 authoring stop latch；
捕获 reject 不会恢复后续 NiceEval API 的登记能力。未 threshold 的 measurement 调用 `.gate()`／`.orStop()` 是作者错误；
handle 没有 threshold combinator，`gate` 也不接参数。

没有 model、key 或 provider 时不发网络预检，Assertion 为 `unavailable` 并保留机器可读 reason。完整配置
的 endpoint 预检失败是 setup error，受影响 Attempt 不执行 Agent，也不伪造 AssertionResult。
Runner 通过 `judge-precheck-failed` 运行级 diagnostic 交付端点、模型与 provider 返回的有界错误。

这类 Slot 从未派发，没有 origin Attempt 或 locator。JSON 不为它伪造 locator-addressable `eval` 事件；
对应 warning 直接携带 `experimentId`、`evalId`、`planned` 与 `errored`，最终计数仍把它记为 `errored`。

模型请求后的传输失败是 `unavailable`。无效响应、非有限数值和区间外数值是 `errored`。原生 decision
的公开 rationale 写入 Judge rationale；输入材料不作为模型返回的 evidence 重新落盘。

## 读取

Judge 继续写 `niceeval.assertions` 中既有 `judge-measurement/v1` artifact。schema 19 的 `result.json` 以
`assertionResults` 保存 Judge evaluation 与 policy projection。运行反馈、固定 query 与 View
使用同一投影；Judge 没有专用展示分支。
