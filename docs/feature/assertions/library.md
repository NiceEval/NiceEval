# Assertions —— Library

完整持久化语义在 [Assertions](README.md)。所有作者入口都遵守“调用即登记；handle 只配置同一 entry”。`entryId` 由 producer 分配；作者的 key、label 与 groupPath 只服务展示。

## 显式值、`check` 与 `judge`

```ts
const config = t.check(rawConfig, matches(ConfigSchema))
  .key("config-valid")
  .label("配置有效");

t.check(turn.message, includes("完成"))
  .label("说明完成");
t.judge({ request, summary: turn.message }, summaryQuality)
  .gate(0.8)
  .label("摘要质量");
```

root `t`、Session 与 Turn 都提供同形态的 `check(subject, match)` 和 `judge(material, definition)`。`check` 接受普通 Match，也接受 `JudgeDefinition`；`judge` 是只接受 `JudgeDefinition` 的薄包装。两者进入同一个 dispatcher，每次调用只登记一个 entry，并且只求值一次。`judge` 不隐式选择 `Turn.message`、transcript 或其它材料。

两种入口都严格接收两个参数，不接收 options、已有 handle、已有 Assertion 或省略第二参数的形状。handle 不能作为 subject。自定义 Adapter 的上下文顶层保留 `judge` 名称；类型检查与运行时检查都拒绝应用成员占用它。

`toolCalls` 与 `eventOccurrences` 是合法 managed subject；原始 `events` 是合法普通 Value subject。`t.check(turn.toolCalls, m)` 与 `turn.check(turn.toolCalls, m)` 等价。cut 由 subject 携带，不由调用 `check` 的 ctx 重新裁切。完整规则见 [Scoped assertions](library/scoped-assertions.md)。

## scope 与领域包装

```ts
const turn = await t.send("总结需求。");

turn.succeeded().label("Turn 完成");
turn.calledTool(toolMatch("search").atLeast(2)).label("至少搜索两次");
turn.maxToolCalls(2).label("工具次数上限");
t.judge({ request: "总结需求", summary: turn.message }, summaryQuality)
  .gate(0.8)
  .label("摘要质量");
```

工具领域包装是 `check(toolCalls, Match)` 的语法糖，与显式 `check` 共用 evaluator、criterion、sealed result 与读取协议。event 包装对 `eventOccurrences` 做同一件事。`defineJudge` 与现成裁判调用公开 `defineScoreMatch`，返回真实 `ScoreMatch`；`judge(material, definition)` 只替作者约束第二参数，随后调用相同的 `check`。高级自定义连续 Match 通过受管 context 执行模型 I/O，复用调用预算、失败处理和审计材料。

`calledTool`、`notCalledTool`、`usedNoTools`、`maxToolCalls`、`toolOrder` 与 `toolCalls` 只在 [Scoped assertions](library/scoped-assertions.md) 定义。本页不复制另一份字段表。

`maxTokens` 与 `maxCost` 也是领域包装。它们把 scope-owned usage fact 交给 `atMost(limit)`，与显式数值比较共用 evaluator、criterion 和登记语义；完整口径与 partial 规则同样只在 [Scoped assertions](library/scoped-assertions.md#usage-上限包装) 定义。

## handle 配置

| 方法 | 适用范围 | 效果 |
|---|---|---|
| `.key(value)` | 所有仍可配置的 Assertion | 设置人读的稳定展示 key。 |
| `.label(value)` | 所有仍可配置的 Assertion | 设置人读标签。 |
| `.gate()` | Pass／Score Eval 的 Boolean | 让 Boolean condition 参与 [Verdict](../verdict/architecture.md) 四态 fold。 |
| `.gate(minimum)` | Pass／Score Eval 的 measurement | 形成唯一的 `measurement >= minimum` condition，并让它参与 Verdict fold。 |
| `.score(points)` | Score Eval 的 Boolean 或 measurement | 让该 entry 把 points／earned contribution 封口到 Assertions；它可与 gate 任意先后组合。 |
| `.ifCovered()` | Usage Assertion | 已声明 unavailable 时保留为 not-applicable；lower-bound 仍按数值比较规则求值。 |
| `.optional()` | Pass Eval 中支持 optional 的 Boolean | 保留事实，但材料 unavailable 不单独改变 Verdict。 |
| `.orStop()` | Boolean，或已经有 condition 的 measurement | 等待同一 entry，并在 condition 不满足时停止当前 continuation。 |
| `.orStop(minimum)` | 尚无 condition 的 measurement | 原子形成唯一停止 condition，并在它不满足时停止当前 continuation；不会隐式 gate。 |

measurement 的 `minimum` 必须是有限 `[0,1]` 数值。连续 Match 和 `JudgeDefinition` 都没有 `.atLeast()`；数值 Match 以及工具／事件 occurrence Match 的 `.atLeast()` 继续表达各自领域的比较或次数。

同一 entry 只能形成一个 condition。已有 condition 后再传数值、重复 `gate`、重复 `score`、重复 key／label、封口后配置或 detached async 配置都是作者错误。`gate(minimum)` 后可用无参 `.orStop()` 复用 condition。首次 `.orStop(...)` 完成同步参数校验后，会原子设置 condition 与 required，并结束该 entry 的全部配置阶段，再启动等待；后续 `.score()`、`.gate()`、`.key()` 或 `.label()` 同步拒绝。重复无参等待复用原 stop Promise，不产生新的求值、condition 或 source site。

Boolean `.orStop()` 使用自身 condition。stop requirement 不能被 optional 豁免；`unavailable` 或 `errored` 会停止并让 Attempt `errored`，低于 measurement minimum 的 stop-only entry 正常停止，但不会在读取时被提升为 gate。共享 stop latch 不会被 `catch`、换 Turn 或换 Session 清除；它不承诺终止任意 JavaScript 或已经发出的外部 I/O。

## 两种 Eval

`defineEval` 创建 Pass Eval。Boolean condition 默认 required 且参与 Verdict，既有 `.optional()` 例外保持。未配置 gate 的 measurement 只保存 evaluation measurement；`.gate(minimum)` 才形成显式质量门。Pass context 不提供 `t.score` 或 handle `.score`。

```ts
t.judge({ question, answer: turn.message }, answerQuality)
  .gate(0.8)
  .label("可执行性");
```

`defineScoreEval` 创建同时拥有 Verdict 与 earned score 的 Score Eval。Boolean 和 measurement 默认 record-only optional；`.score(points)` 让 entry 贡献数值，`.gate(...)` 让 condition 参与同一四态 Verdict。measurement 可以同时 gate 和 score，并且 evaluator 只运行一次。低分本身不失败，显式 gate 失败才得到 `failed`，同时保留 continuous contribution。`t.score(points)` 直接登记带 direct-score criterion 的 Assertion entry。

```ts
turn.calledTool("search").gate().score(2).label("必须检索");
t.judge({ task, answer: turn.message }, answerQuality)
  .score(5)
  .gate(0.8)
  .label("答案质量");
t.score(1).label("人工加分");
```

Score 没有 generic `.optional()`。post-run Sandbox Assertion 在 Score Eval 中可以 gate，但运行时和类型面都不提供 `.orStop()`；direct-score handle 同样没有 gate 或 stop。完整度只说明 contribution 是否可计算，不能把 `failed + complete` 改写成成功状态。完整规则见 [Score Eval](library/score-points.md)。

## 组

`t.group(title, fn)` 只写 display 的 `groupPath` 与 source organization。它不改变 subject、criterion、结果、Eval 类型或 route identity。

```ts
await t.group("输出", () => {
  t.check(turn.message, includes("下一步")).label("给出下一步");
  t.judge({ question, answer: turn.message }, answerQuality)
    .gate(0.8)
    .label("可执行性");
});
```

值比较见 [Value assertions](library/value-assertions.md)，scope 见 [Scoped assertions](library/scoped-assertions.md)，Score Eval 见 [Score Eval](library/score-points.md)。
