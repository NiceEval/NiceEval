---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# 用 gate 守住质量

开放式质量检查先用代表性结果校准 rubric 和阈值。把阈值写在 Judge Match 的 `.atLeast(n)` 上，再用 handle 的无参 `.gate()` 把已确定的要求写成稳定的 Pass Eval Assertion。
`.atLeast(n)` 形成局部 condition；只有 `.gate()` 让它参与 Verdict fold。

```typescript
import { closedQA } from "niceeval/expect";

turn.check(
  { input: turn.input, output: turn.message },
  closedQA("回答是否完整且准确？").atLeast(0.8),
).gate().label("回答质量");
```

measurement 低于阈值时 Attempt 为 `failed`；Judge 无法评估时 Attempt 为 `errored`，
不会把配置或网络问题伪装成 Agent 失败。

需要让依赖后续步骤在阈值不满足时停下的场景，在同一 handle 上 await `.orStop()`：

```typescript
const quality = turn.check(
  { input: turn.input, output: turn.message },
  closedQA("回答是否满足安全要求？").atLeast(0.9),
).gate().label("安全质量");
await quality.orStop();
await t.send("继续执行下一步");
```

`.orStop()` 只停止当前 continuation。正常 stop 后 Attempt 仍按触发 Assertion 得到 `failed` Verdict。

计分制若要按质量比例贡献分数，使用 `.score(points)`：measurement `m` 贡献 `m * points`。

```typescript
turn.check(
  { input: turn.input, output: turn.message },
  closedQA("说明是否清晰？"),
).score(20).label("说明质量");
```

## 终端输出案例

以下是嵌入正式 `RESULTS` 或 Attempt detail 的最小字段片段，不是 `niceeval exp` 的独立完整输出。
Invocation 的结束标题、Run block 与下钻命令由 [Experiments CLI](../../experiments/cli.md#结束反馈与-receipt)
拥有；Attempt detail 的固定外层由 [Inspection CLI](../../inspection/cli.md#attempt-概览示例)拥有。`measurement`
始终同时显示实际值与 required threshold，不能被显示成 score。

### Pass Eval：通过、阈值未达、无法评估与显式跳过

```text
Verdict     passed
回答质量    measurement 0.92 · required ≥ 0.80
```

```text
Verdict     failed
回答质量    measurement 0.63 · required ≥ 0.80
```

`failed` 是已经取得的 gate condition 未满足；它不是 Judge、配置或 execution 的错误。

```text
Verdict     errored
回答质量    unavailable · Judge API key is not configured
```

```text
Verdict     skipped · benchmark input is not applicable
回答质量    not run
```

Execution 的真实错误仍由正式 Attempt detail 和结束反馈显示；它不改写成 `failed`。显式 skip 只有在没有
更高优先级错误时才显示为 `skipped`。

### Score Eval：完整分数与合法零分

```text
Verdict     passed
Score       16 score · complete
说明质量    +16 · measurement 0.80
```

```text
Verdict     passed
Score       0 score · complete
说明质量    +0 · measurement 0.00
```

低分、measurement 为零与 earned `0` 都是完成的可比较结果，不能隐藏为 unavailable。Score Eval 没有
gate，所以不存在由低分产生的 Score `failed` 输出；`failed` 的终端案例属于上面的 Pass Eval。

### Score Eval：部分事实、无可审计分数与显式跳过

```text
Verdict     errored
Score       ≥16 score · partial
说明质量    +16 · measurement 0.80
引用检查    unavailable · evaluation interrupted
```

```text
Verdict     errored
Score       unavailable
说明质量    unavailable · Judge API key is not configured
```

```text
Verdict     skipped · source document is empty
Score       6 score · complete
标题覆盖    +6 · matched
```

`partial` 只显示已封口 contribution 的已知下界及 Issue，绝不把下界当成完整分数。`unavailable` 没有
可审计的 earned 数值，因而没有 `0`。skip 前已封口的 contribution 照实显示，但该 Attempt 不参加排名。

## 边界

- Pass Eval 先在 Match 上形成 threshold；handle 调用 `.gate()` 后，低于阈值才使 Attempt 为 `failed`。只登记 thresholded Match 会保存 condition，不参与 Verdict fold。
- Score Eval 没有 `.gate()`；`.score(points)` 按 measurement 比例贡献分数，低分不改变 Verdict。
- gate 无法评估（Judge 缺 key、证据不可用）为 `unavailable`，Attempt 为 `errored`，不是 `failed`。

## 相关阅读

- [Verdict 与 AssertionResult](../architecture.md) —— Pass fold 规则。
- [Judge](../../judge/library.md) —— Judge evaluator 与配置。
- [Assertions · Score Eval](../../assertions/library/score-points.md) —— score contribution。
