# Assertions

Assertion 是 Attempt 内规范化、可留档的检查事实。
值 matcher、作用域检查、Sandbox 验证、资源上限和 Judge 都形成同一种 Assertion result。producer 在 whole Run 发布前把它写入 Attempt-owned `RecordAttachment`：名称为 `niceeval.assertions`，payload schema 为 `niceeval.assertions/v1`。这一层负责检查什么、证据是否完整以及当时的判断怎样落盘，不决定 Attempt 的 lifecycle 或最终 Verdict。

作者仍通过 assert-first API 登记检查。作者 API、matcher、collector 和求值顺序都不落盘。producer 把它们的内存结果归一成 `niceeval.assertions/v1` payload；Record 与标准 Report 只依赖该 `RecordAttachment` 的 owner、schema 和 payload，不依赖产生它的 API 或运行时类型。

Assertions schema 独立于 Record Core 演进。发布相邻 payload schema 时，Attachment family 必须提供精确 converter，或明确声明 `not-losslessly-migratable`；详情见 [Architecture](architecture.md#attachment-schema-演进)。assert-first 作者模型的变化不要求修改 Record Core。

这项稳定承诺从 `niceeval.assertions/v1` 首次发布开始。payload 的精确形状与跨代读取条件见 [Architecture](architecture.md#稳定-recordattachment-payload)。

| 名称 | 含义 |
|---|---|
| subject | Assertion 调用时读取的对象：显式 `value`，或 receiver 选定的 scope snapshot。 |
| Match | 可复用、不可变、确定性、无副作用的值比较或 evaluator 规则。它没有 identity、callsite 或 policy。 |
| Assertion | 作者直接登记的评估陈述。它绑定 subject、snapshot、evaluator、callsite、source order 与 groupPath。 |
| AssertionHandle | 同一 entry 的配置引用。配置只更新此 entry，不登记第二条 Assertion。 |
| AssertionResult | 同一 entry 的 evaluation、policy 和按 Eval 类型计算的 projection。 |
| measurement | 连续 evaluator 给出的有限 `[0,1]` 数值。它是诊断证据，不是 Pass Eval 的分数。 |

每条 Assertion 的 `key` 与 `label` 最多各配置一次。重复配置即使写入同一个值也是作者错误。

调用时 NiceEval 冻结 subject、snapshot、callsite、source order 与 groupPath。evaluator 可以立即开始，
同一 entry 的 raw evaluation 只 memoize 一次。`.orStop()` 或 test 的 settle 会封口 entry；封口后配置，
或 test 返回后的 detached async 配置，都是作者错误。

## 作者入口

`t.check` 只有一种形状：`t.check(value, match)`。它严格接收两个参数，直接登记 Assertion 并返回
该 entry 的 handle。没有一参数、三参数或 `check(handle)` 形状。

```ts
t.check(turn.message, includes("已完成"))
  .key("reply-complete")
  .label("说明已完成");
```

`t.succeeded()`、`session.succeeded()`、`turn.succeeded()`、
`calledTool("name", options?)` 等 scoped 方法也直接登记 Boolean Assertion。Judge recipe 同样直接
登记 Assertion。

```ts
const turn = await t.send("搜索资料并说明结论。");

turn.succeeded().label("Turn 完成");
turn.calledTool("search").label("调用搜索工具");
turn.judge.autoevals.closedQA("回答是否完整？").label("回答质量");
```

Usage Assertion 独有 `.ifCovered()`。它只把 Agent 创建时已声明 usage 不可用投影为
`notApplicable`；采集过程中失败仍是 `unavailable`。

## Pass Eval

Pass Eval 的最终 grading 是 Attempt Verdict：`passed`、`failed`、`errored` 或 `skipped`。它没有
`t.score`、handle `.score`、累计 score 或其它数值结果。

Boolean `matched` 进入 Verdict。`mismatched` 默认使最终 Verdict 为 `failed`，但不会阻止后续
检查继续登记和结算。

连续 evaluator 与 Judge recipe 可以给出 measurement。Pass Eval 必须对它调用 `.atLeast(n)`，才把它
封口为 Boolean condition；未设 threshold 的 measurement 在 finalize 时是作者错误。`n` 必须是有限
`[0,1]` 数值。

```ts
turn.judge.autoevals.closedQA("回答是否给出可执行步骤？")
  .atLeast(0.8)
  .label("步骤可执行");
```

Boolean handle 与已经 threshold 的 measurement handle 都可以 `await .orStop()`。Pass 的读取面只显示
measurement，例如 `0.73, required >= 0.8, mismatched`；它绝不把 measurement 显示成 score。

## Score Eval

Score Eval 的最终 grading 只有累计 `score`，分数越高越好。它没有 Attempt Verdict、总分、分母、
百分比、`0–100` 归一化或另一种数值单位。

Assertion 默认只保存 evaluation、evidence 和 diagnostic，不自动贡献 `1` 或 `0`。不计分 Assertion
完全合法。用 `handle.score(n)` 才让已有 Assertion 贡献 score，`n` 必须 finite 且大于零，并且最多配置一次。

```ts
turn.calledTool("search");
turn.calledTool("search").score(2);
turn.judge.autoevals.closedQA("回答完整").score(5);
t.score(5);
```

上例分别表示只保存 evaluation、匹配时 `+2`、measurement 为 `.8` 时 `+4`，以及直接 `+5`。Boolean matched
贡献 `n`，mismatched 贡献 `0`；measurement `m` 贡献 `m * n`。

`t.score(n)` 只存在于 `ScoreTestContext`。它严格接收一个 finite 且不小于零的数值，直接登记
contribution，并返回只可配置 `key` 与 `label` 的 `DirectScoreHandle`。它不能再次 `.score()`、
`.atLeast()` 或 `.orStop()`，也不接收 handle。

Score Eval 的 measurement 不必 threshold 就能封口。`.atLeast(n)` 只增加局部 `met` / `below`
condition；它不改变 score。Boolean handle 可以直接 `.orStop()`；measurement 必须先 `.atLeast(n)`
才能 `.orStop()`。`.score()` 与 `.atLeast()` 的先后可以互换。

没有 `.score()` 的 Assertion 不显示 `+0`。`scoreContribution` 缺失与明确的
`scoreContribution: 0` 必须区分。正常 Score Eval 即使没有计分项，也得到正式且可排名的 `score: 0`；
读取面提示“没有贡献分数的评分项”。

## `.orStop()`

`.orStop()` 是同一 AssertionHandle 的 async barrier，不是第二条 Assertion，也不是另一种 require API。
必须 `await` 它。Runner 通过 tracked awaitable、pending barrier 与 context latch 发现常见 floating call，
但不承诺识别所有漏 await。

当 Boolean mismatch，或 thresholded measurement 为 below 时，`.orStop()` 设置 Attempt authoring
stop latch，并 reject 私有控制信号。作者即使捕获该信号，latch 仍保留，之后 NiceEval 作者 API 拒绝登记。

它只停止当前被 await 的 continuation，不撤销已发生的普通 JavaScript 副作用，也不取消此前启动的并发任务。
stop 前已经登记或已启动的 evaluator 仍会结算。尚未执行的源码不会生成 AssertionResult、`notReached`
或补零。

正常 stop 后，Pass Eval 仍按触发 Assertion 得到 `failed` Verdict。Score Eval 仍是 `scored`，保留正式
score 和 stop cause，因此可以排名。不存在名为 `stopped` 的独立终态。

## Scope 与 `succeeded`

`t`、Session 与 Turn 都读取 call-time snapshot，只是 scope 不同：

| receiver | subject snapshot |
|---|---|
| Turn | 不可变的该 Turn。 |
| Session | 调用点之前的该 Session 前缀。 |
| 根 `t` | 调用点所有已启动 Session 的 vector cut。 |

Session 在第一次交互开始时才算已启动；空 handle 不算。因此早调用不会被未来事件补成通过，早晚两个
`t.succeeded()` 可以不同。根 scope 没有“最后阶段”，也不能读取 last status。

零活动的 `t.succeeded()` 确定地 `mismatched`。运行中或没有可信终态时不能当作 completed。

`succeeded` 检查可信终态与 unresolved HITL，不等于 `noFailedActions`。动作失败后恢复并完成时，前者可
matched 而后者 mismatched；协议终态为 failed 时 `succeeded` mismatched。只有文本出现“502”但协议为
completed 时不猜测失败。没有 snapshot 的 transport 是 execution error。Judge 失败与 `succeeded` 无关。

## 不可用与结果信息

缺少 evidence 不能伪装成普通 mismatch。`unavailable` 与 `errored` 保留原因、脱敏 evidence、
explanation 和 Judge rationale。每条 AssertionResult 都按同一个 `check(a, b)` 模型保存 subject `a` 的
安全结构化内容或稳定引用、evaluator / Match `b` 的 identity 与完整安全 config，以及 evaluation；不能只保存
成功或失败。`calledTool`、`loadedSkill`、`succeeded` 与 Judge recipe 只是替作者取得 `a` 并构造 `b` 的特例，
保存规则不变。secret 绝不属于 AssertionResult。

Assertion 只规定结果必须保留哪些 subject、evaluator、evaluation、evidence、policy 与 projection；
它不在这里规定任何持久化布局或跨版本读取规则。

完整字段、不可排名规则与 display contract 见 [Architecture](architecture.md)。

## 继续阅读

- [Library](library.md) —— 作者 API 和 handle 配置。
- [Value assertions](library/value-assertions.md) —— Match 与 refinement。
- [Scoped assertions](library/scoped-assertions.md) —— scope snapshot 与 `succeeded`。
- [Score Eval](library/score-points.md) —— 累计 score 的局部贡献。
- [Architecture](architecture.md) —— AssertionResult 与两种 grading。
- [Judge](../judge/README.md) —— Judge evaluator 的配置与材料。
