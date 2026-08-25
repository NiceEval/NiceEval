# Assertions —— Library

完整持久化语义在 [Assertions](README.md)。所有作者入口都遵守“调用即登记；handle 只配置同一 entry”。`entryId` 由 producer 分配；作者的 key、label 与 groupPath 只服务展示。

## 显式值与 `check`

```ts
const config = t.check(rawConfig, matches(ConfigSchema))
  .key("config-valid")
  .label("配置有效");

t.check(turn.message, includes("完成"))
  .label("说明完成");
turn.check(turn.toolCalls, atMost(2))
  .label("工具次数上限");
```

root `t`、Session 与 Turn 都提供同形态的 `check(subject, match)`。它只接收两个参数。
它不接收 options、已有 handle、已有 Assertion 或省略 Match 的一参数形式。
handle 不能作为 subject。

`toolCalls` 与 `eventOccurrences` 是合法 managed subject；原始 `events` 是合法普通 Value subject。
`t.check(turn.toolCalls, m)` 与 `turn.check(turn.toolCalls, m)` 等价。
cut 由 subject 携带，不由调用 `check` 的 ctx 重新裁切。完整规则见 [Scoped assertions](library/scoped-assertions.md)。

## scope 与 Judge Match

```ts
const turn = await t.send("总结需求。");

turn.succeeded().label("Turn 完成");
turn.calledTool(toolMatch("search").atLeast(2)).label("至少搜索两次");
turn.maxToolCalls(2).label("工具次数上限");
turn.check(
  { input: turn.input, output: turn.message },
  summarizes(source).atLeast(0.8),
).gate().label("摘要质量");
```

工具领域包装是 `check(toolCalls, Match)` 的语法糖，与显式 `check` 共用 evaluator、criterion、sealed result 与读取协议。
event 包装对 `eventOccurrences` 做同一件事。Judge factories 则从 `niceeval/expect` 返回纯 managed
`ScoreMatch<JudgeMaterial>`；factory 不读取 ctx、不绑定 subject、不登记，显式 `check` 才一次完成登记并调用 Judge Provider。
`succeeded` 仍读取 scope 终态。

`calledTool`、`notCalledTool`、`usedNoTools`、`maxToolCalls`、`toolOrder` 与 `toolCalls` 只在 [Scoped assertions](library/scoped-assertions.md) 定义。本页不复制另一份字段表。

`maxTokens` 与 `maxCost` 也是领域包装。它们把 scope-owned usage fact 交给 `atMost(limit)`，与显式数值比较共用 evaluator、criterion 和登记语义；完整口径与 partial 规则同样只在 [Scoped assertions](library/scoped-assertions.md#usage-上限包装) 定义。

## handle 配置

| 方法 | 适用范围 | 效果 |
|---|---|---|
| `.key(value)` | 所有 Assertion | 设置人读的稳定展示 key。 |
| `.label(value)` | 所有 Assertion | 设置人读标签。 |
| `.gate()` | Pass Eval 的 Boolean 或已 threshold measurement | 让已形成的本地 condition 参与 [Verdict](../verdict/architecture.md) 四态 fold；不接 threshold。 |
| `.score(points)` | Score Eval 的已有 Assertion | 让该 entry 把 points／earned contribution 封口到 Assertions。 |
| `.ifCovered()` | Usage Assertion | 已声明 unavailable 时保留为 not-applicable；lower-bound 仍按数值比较规则求值。 |
| `.optional()` | 支持 optional 的 Boolean Assertion | 保留事实，但材料 unavailable 不单独改变 Verdict。 |
| `.orStop()` | Boolean 或已 threshold 的 measurement | 等待同一 entry，并在 condition 不满足时停止当前 continuation。 |

threshold 只在登记前由 `ScoreMatch.atLeast(n)` 形成 `ThresholdedScoreMatch`。handle 没有 threshold combinator，
`gate` 也不接参数；无 threshold measurement 调用 `.gate()`／`.orStop()` 是作者错误。同一政策重复配置、非法数值、封口后配置与 detached async 配置也是作者错误。

## 两种 Eval

`defineEval` 创建 Pass Eval。Boolean condition 默认是 gate。measurement 的 threshold 必须先在 Match 上形成；
已 threshold 的 handle 用无参 `.gate()` 才让本地 condition 进入 failed Verdict。Pass context 不提供 `t.score` 或 handle `.score`。

```ts
turn.check(
  { input: turn.input, output: turn.message },
  closedQA("回答是否可执行？").atLeast(0.8),
)
  .gate()
  .label("可执行性");
```

`defineScoreEval` 创建只按 earned score 比较的 Score Eval。Assertion 默认只保存 evaluation；`.score(points)` 才贡献数值。
Score 没有 gate；无 threshold `ScoreMatch` 仍可 record-only 或 `.score(points)`，thresholded Match 还可 `.orStop()`。
正常封口即使 earned 为 `0` 也为 `passed`。`t.score(points)` 直接登记带 direct-score criterion 的 Assertion entry。

```ts
turn.calledTool("search").score(2).label("检索");
t.score(1).label("人工加分");
```

两种 Eval 的 Verdict 都从 Core 与 sealed Assertions 读侧折叠。Score 同样在读侧按 points、earned contribution 与 rubric 形成，不增加 durable family。完整度、缺少材料与可比较性见 [Score Eval](library/score-points.md)；显示和源码导航通过固定 [Inspection Operations](../reports/architecture.md) 的闭合结果完成。

## 组

`t.group(title, fn)` 只写 display 的 `groupPath` 与 source organization。它不改变 subject、criterion、结果、Eval 类型或 route identity。

```ts
await t.group("输出", () => {
  t.check(turn.message, includes("下一步")).label("给出下一步");
  turn.check(
    { input: turn.input, output: turn.message },
    closedQA("是否容易执行？").atLeast(0.8),
  ).gate().label("可执行性");
});
```

值比较见 [Value assertions](library/value-assertions.md)，scope 见 [Scoped assertions](library/scoped-assertions.md)，Score Eval 见 [Score Eval](library/score-points.md)。
