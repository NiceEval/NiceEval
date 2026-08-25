# Eval —— Library

写一个 eval 像写一个测试：一个文件、一个 `test(t)` 函数。`test(t)` 驱动 Agent、读取结果，并在观察处
直接登记 Assertion。`defineEval` 各字段见 [README](README.md)。

```ts
import { includes, jsonMatch, toolMatch } from "niceeval/expect";

export default defineEval({
  description: "布鲁克林天气查询",
  async test(t) {
    const turn = await t.send("布鲁克林今天天气怎么样？");
    turn.succeeded().label("Turn 完成");
    turn.calledTool(
      toolMatch("get_weather", { input: jsonMatch({ city: "Brooklyn" }) }).exactly(1),
    );
    t.check(turn.message, includes("晴")).label("回答天气");
  },
});
```

## API 全景

| API 组 | 用途 | 契约单源 |
|---|---|---|
| `t.send` / `t.sendFile` / `t.newSession` | 驱动会话，返回不可变 Turn | [Context](library/context.md) |
| `t.reply` / `t.events` / `turn.message` / `turn.data` | 读取结果 | [Context · 读取结果](library/context.md#读取结果) |
| `succeeded` / `calledTool` / `toolOrder` / `event` / `maxTokens` | scope Assertion | [Scoped assertions](../assertions/library/scoped-assertions.md) |
| `t.check(subject, match)` | 唯一登记原语；scope wrapper 是它的薄糖 | [Value assertions](../assertions/library/value-assertions.md) |
| Match 的 `.atLeast(n)` / handle 的 `.gate()`、`.orStop()` | 先形成 threshold，再配置 Pass condition 或 async barrier | [Assertions](../assertions/README.md) |
| `.score(points)` / `t.score(points)` | Score Eval 的显式 contribution | [Score Eval](../assertions/library/score-points.md) |
| `closedQA` / `factuality` / `summarizes` | 构造 Judge Match，交给 `check` 登记 | [Judge](../judge/library.md) |
| `t.sandbox.*` | 文件 IO、命令执行与 diff Assertion | [Sandbox operations](../sandbox/library/operations.md) |

`t.group(title, fn)` 只组织 `groupPath`。它不改变 subject、evaluator、policy 或 grading。

## 两种 Eval

`defineEval` 创建 Pass Eval。Boolean condition 是 gate；Verdict 在 Assertion 封口后由 Core `outcome`、
sealed Assertions 与显式 skip 读侧折叠。continuous measurement 先在 Match 上用 `.atLeast(n)` 形成 threshold，再用无参 `.gate()` 才进入 failed，context 没有 `t.score`
或 handle `.score`。

`defineScoreEval` 创建 Score Eval。Assertion 默认 record-only；用 `.score(points)` 或 `t.score(points)`
显式贡献 score。

`points`、earned contribution 与完整度都封口在 `niceeval.assertions` family 的 `schemaVersion: 1` envelope 中，Score 按同一份
rubric 在读侧形成。Score Eval 不声明 gate、max 或百分比；低分和零分不导致 `failed`，正常封口为 `passed`。
execution error 读为 `errored`，显式 `t.skip(reason)` 读为 `skipped`。thresholded measurement 的 `.orStop()` 只停止当前 continuation。

详细 API 与完整场景见 [Use cases](use-case/README.md)。
