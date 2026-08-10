# Assertions —— 作用域 Fact

turn、session 和根 `t` producer 使用同一份 Match，但接收者决定证据范围。根 `t` 可以聚合 presence、absence 与 count；order-sensitive producer 只存在于单个 Turn 或 Session：

```ts
import { includes, toolMatch } from "niceeval/expect";

const first = await t.send("查询 Brooklyn 天气");
t.check(first.calledTool(toolMatch("get_weather")));

const branch = t.newSession();
await branch.send("查询 San Francisco 天气");
t.check(branch.calledTool(toolMatch("get_weather")));

t.check(t.reply, includes("天气"));
```

所有 scope 都提供：

- 状态与动作：`succeeded`、`parked`、`calledTool`、`notCalledTool`、`usedNoTools`、`maxToolCalls`、`noFailedActions`；
- 事件：`event`、`notEvent`、`loadedSkill`；
- 用量：`maxTokens`、`maxCost`。

Turn 与 Session 另外提供 `toolOrder`、`eventOrder` 和 `eventsSatisfy`。Session 内按 `(turnOrdinal, eventOrdinal)` 形成稳定全序；Turn 是其中的单轮切片。根 `t` 跨多个可并发 Session，没有稳定总序，因此不公开这三个入口。

它们都返回 Fact；要改变 Attempt 判定，必须再调用 `t.check` 或 `await t.require`。`maxTokens` 与 `maxCost` 返回 usage evidence Fact，因此核心在需要“没有 usage 就不适用”时也可以使用窄入口 `checkIfCovered`；普通作者默认仍应 `check`，让证据缺失诚实进入 `errored`。

缺少 complete evidence 时，正向匹配仍可用已经存在的证据通过。需要证明不存在的 producer，例如 `notCalledTool`，以及上限和完整计数，不能把缺失事件当成不存在；它们产生 `unavailable`。普通消费 use 会把该状态保留到 Attempt 终态。

工具 occurrence 表示一次归一化的逻辑调用：started 与 finished 关联到同一 identity，适合 name、input、status、次数和调用 request 次序。event 表示 typed timeline 中的一行：started、finished 与 message 各是不同 event，适合 lifecycle 与消息之间的时序。

普通工具需求优先使用 `calledTool`、`notCalledTool` 与 `toolOrder`。只有必须区分 started / finished，或把工具 lifecycle 与 message 排在同一时间线上时，才使用 `eventMatch` 与 `eventOrder`。`toolOrder` 只证明不同 occurrence 的 request subsequence；`eventOrder` 证明不同 event identity 的有序子序列，未匹配事件可以穿插。

工具条件使用 `toolMatch(name, options)`，事件条件使用 `eventMatch(type, options)`。operation event 通过 `tool` 关联已有 logical occurrence，不重复公开 name、input、command、status；output 的证据完整度不足，暂不开放。精确计数写在 producer 的第二个参数 `{ count }`，不用 consumer 修饰符表达。

`eventsSatisfy(label, predicate)` 只是在具名 matcher 无法表达跨事件关联时使用的 escape hatch，不替代 presence、count 或 order producer。任意 predicate 只在 event evidence complete 时运行；证据不完整时 Fact 为 unavailable，避免把不完整切片上的 `false` 当成 failed。

predicate 接收封闭、冻结的 `AssertionEvent[]`，只公开稳定 event identity、Session position、message 字段，以及 operation 对应的 logical tool identity、name 与 finished status。它不接收 raw Adapter event，也看不到 raw operationId、output、command projection 或 Adapter metadata。
