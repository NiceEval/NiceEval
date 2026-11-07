# Assertions —— Library

完整持久化语义在 [Assertions](../README.md)。所有作者入口都遵守“调用即登记；handle 只配置同一 entry”。`entryId` 由 producer 分配；作者的 key、label 与 groupPath 只服务展示。

## 显式值、`check` 与 `judge`

```ts
const config = t.check(rawConfig, matches(ConfigSchema))
  .key("config-valid")
  .label("配置有效");

t.check(turn.reply, includes("完成"))
  .label("说明完成");
t.judge({ request, summary: turn.reply }, summaryQuality)
  .gate(0.8)
  .label("摘要质量");
```

root `t`、Session 与 Turn 都提供同形态的 `check(subject, match)` 和 `judge(material, definition)`。`check` 接受普通 Match，也接受 `JudgeDefinition`；`judge` 是只接受 `JudgeDefinition` 的薄包装。两者进入同一个 dispatcher，每次调用只登记一个 entry，并且只求值一次。`judge` 不隐式选择 `Turn.message`、transcript 或其它材料。

两种入口都严格接收两个参数，不接收 options、已有 handle、已有 Assertion 或省略第二参数的形状。handle 不能作为 subject。自定义 Adapter 的上下文顶层保留 `judge` 名称；类型检查与运行时检查都拒绝应用成员占用它。

`toolCalls` 与 `eventOccurrences` 是合法 managed subject；原始 `events` 是合法普通 Value subject。`t.check(turn.toolCalls, m)` 与 `turn.check(turn.toolCalls, m)` 等价。cut 由 subject 携带，不由调用 `check` 的 ctx 重新裁切。完整规则见 [Scoped assertions](scoped-assertions.md)。

## scope 与领域包装

```ts
const turn = await t.send("总结需求。");

turn.succeeded().label("Turn 完成");
turn.calledTool(toolMatch("search").atLeast(2)).label("至少搜索两次");
turn.maxToolCalls(2).label("工具次数上限");
t.judge({ request: "总结需求", summary: turn.reply }, summaryQuality)
  .gate(0.8)
  .label("摘要质量");
```

工具领域包装是 `check(toolCalls, Match)` 的语法糖，与显式 `check` 共用 evaluator、criterion、sealed result 与读取协议。event 包装对 `eventOccurrences` 做同一件事。`defineJudge` 与现成裁判调用公开 `defineScoreMatch`，返回真实 `ScoreMatch`；`judge(material, definition)` 只替作者约束第二参数，随后调用相同的 `check`。高级自定义连续 Match 通过受管 context 执行模型 I/O，复用调用预算、失败处理和审计材料。

`calledTool`、`notCalledTool`、`usedNoTools`、`maxToolCalls`、`toolOrder` 与 `toolCalls` 只在 [Scoped assertions](scoped-assertions.md) 定义。本页不复制另一份字段表。

`maxTokens` 与 `maxCost` 也是领域包装。它们把 scope-owned usage fact 交给 `atMost(limit)`，与显式数值比较共用 evaluator、criterion 和登记语义；完整口径与 partial 规则同样只在 [Scoped assertions](scoped-assertions.md#usage-上限包装) 定义。

## handle 配置

| 方法 | 适用范围 | 效果 |
|---|---|---|
| `.key(value)` | 所有仍可配置的 Assertion | 设置人读的稳定展示 key。 |
| `.label(value)` | 所有仍可配置的 Assertion | 设置人读标签。 |
| `.gate()` | Pass／Score Eval 的 Boolean | 让 Boolean condition 参与 [Verdict](../../verdict/architecture.md) 四态 fold。 |
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
t.judge({ question, answer: turn.reply }, answerQuality)
  .gate(0.8)
  .label("可执行性");
```

`defineScoreEval` 创建同时拥有 Verdict 与 earned score 的 Score Eval。Boolean 和 measurement 默认 record-only optional；`.score(points)` 让 entry 贡献数值，`.gate(...)` 让 condition 参与同一四态 Verdict。measurement 可以同时 gate 和 score，并且 evaluator 只运行一次。低分本身不失败，显式 gate 失败才得到 `failed`，同时保留 continuous contribution。`t.score(points)` 直接登记带 direct-score criterion 的 Assertion entry。

```ts
turn.calledTool("search").gate().score(2).label("必须检索");
t.judge({ task, answer: turn.reply }, answerQuality)
  .score(5)
  .gate(0.8)
  .label("答案质量");
t.score(1).label("人工加分");
```

Score 没有 generic `.optional()`。post-run Sandbox Assertion 在 Score Eval 中可以 gate，但运行时和类型面都不提供 `.orStop()`；direct-score handle 同样没有 gate 或 stop。完整度只说明 contribution 是否可计算，不能把 `failed + complete` 改写成成功状态。完整规则见 [Score Eval](score-points.md)。

## 组

`t.group(title, fn)` 只写 display 的 `groupPath` 与 source organization。它不改变 subject、criterion、结果、Eval 类型或 route identity。

```ts
await t.group("输出", () => {
  t.check(turn.reply, includes("下一步")).label("给出下一步");
  t.judge({ question, answer: turn.reply }, answerQuality)
    .gate(0.8)
    .label("可执行性");
});
```

值比较见 [Value assertions](value-assertions.md)，scope 见 [Scoped assertions](scoped-assertions.md)，Score Eval 见 [Score Eval](score-points.md)。


## 观测数值与分位数

`expect` 导出 `measured(value: number | null, options: { unavailable: string }): NumericMaterial`。
有限数值返回冻结的 exact 材料；null 返回携带作者原因的 unavailable。非有限数值返回 non-finite-number，绝不把 null 或无效数值转换成零。
原因必须是非空字符串；undefined 和非 number/null 输入是作者错误，同步抛 TypeError。

`quantile(samples: readonly number[], p: number, options?: { method?: "linear" | "nearest-rank" }): QuantileMaterial` 返回数值材料及冻结的 statistics。
statistics 包含 sampleCount、probability 和 method。默认 linear 采用排序副本上的 h=(n-1)*p，在 floor(h) 与 ceil(h) 之间线性插值。
nearest-rank 采用 max(1,ceil(n*p)) 的一基秩。p 必须是 [0,1] 有限数值；端点返回最小值、最大值，单样本返回自身。

不修改输入；不丢弃坏样本。空数组为 no-samples，任一非有限或非数值样本为 non-finite-sample；无效 p、method 或非数组输入同步抛 TypeError。
算法元数据随返回材料进入既有 Assertion source snapshot，不引入新的 criterion 或持久化版本，也不保存完整样本数组。

```ts
import { atMost, isTrue, measured, quantile } from "niceeval/expect";
t.check(measured(latencyMs, { unavailable: "no-actions" }), atMost(1200)).gate();
t.check(quantile(intervalsMs, 0.9), atMost(3000)).gate();
t.check(ready, isTrue()).gate();
t.score(measured(ratio, { unavailable: "no-samples" }), { weight: 20 });
```

`defineScoreEval` 中的 t.score(ratio, { weight }) 接受 [0,1] 比例或 NumericMaterial，不需要自定义 fraction matcher。
越界比例是作者错误，不隐式 clamp；领域确需饱和计分时，作者显式限定范围。unavailable 保留权重并标为不可判定，不按零分伪造观测。
纯报告不登记恒真 Assertion。Adapter 可用既有 ctx.attach 保存 Markdown 或 JSON 统计附件；单行展示的独立 note 模型不在此数值构造契约内。

## 数值单位

`/expect` 导出 `ms`、`seconds`、`tokens`、`usd`、`ratio`、`count` 与 `bytes`，返回冻结的 `Quantity<U>` 对象，字段为 `value` 与 `unit`。构造只接受有限数；非法值及越界比例抛出 RangeError。Quantity 不参与算术，也不自动换算单位。

`measured(Quantity, options)` 返回携带单位的 `NumericMaterial<U>`。`quantile` 接受普通数值数组或单位一致的 Quantity 数组；混合单位抛出 TypeError。数值 Match 的阈值必须与材料单位一致：`t.check(measured(ms(512), { unavailable: "missing" }), atMost(ms(600)))`。普通数值材料只接受普通数值阈值。编译期拒绝跨单位调用；绕过类型时返回 unavailable，不比较未包装的数值。

NumericMaterial 的持久数据保存可选 `unit`，旧数据省略该字段时为无单位。Show 与 View 使用单位呈现数值，例如 `512 ms`、`61.2%` 与 `$0.031`。

`between(minimum, maximum)` 使用同单位、含端点的区间；反序或非有限上界抛出 RangeError，混合单位抛出 TypeError。lower-bound 材料只有超过区间上界时才能判定不匹配，其他情况为 unavailable。

`t.usage.cacheRead.rate(role?)` 返回 `NumericMaterial<"ratio">`，阈值使用 `ratio(n)`。缺失观测保留原 unavailable 原因。
