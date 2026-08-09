# Assertions —— 作用域 Fact

turn、session 和根 `t` producer 使用同一份 Match，但接收者决定证据范围：

```ts
import { includes, toolMatch } from "niceeval/expect";

const first = await t.send("查询 Brooklyn 天气");
t.assert(first.calledTool(toolMatch("get_weather")));

const branch = t.newSession();
await branch.send("查询 San Francisco 天气");
t.assert(branch.calledTool(toolMatch("get_weather")));

t.assert(t.check(t.reply, includes("天气")));
```

scope producer 包括：

- 状态与动作：`succeeded`、`parked`、`calledTool`、`notCalledTool`、`toolOrder`、`usedNoTools`、`maxToolCalls`、`noFailedActions`；
- 事件：`event`、`notEvent`、`eventOrder`、`eventsSatisfy`、`loadedSkill`；
- 用量：`maxTokens`、`maxCost`。

它们都返回 Fact；要改变 Attempt 判定，必须再调用 `t.assert` 或 `await t.require`。`maxTokens` 与 `maxCost` 返回 usage evidence Fact，因此核心在需要“没有 usage 就不适用”时也可以使用窄入口 `assertIfCovered`；普通作者默认仍应 `assert`，让证据缺失诚实进入 `errored`。

缺少 complete evidence 时，正向匹配仍可用已经存在的证据通过。需要证明不存在的 producer，例如 `notCalledTool`，以及上限和完整计数，不能把缺失事件当成不存在；它们产生 `unavailable`。普通消费 use 会把该状态保留到 Attempt 终态。

工具条件使用 `toolMatch(name, options)`，事件条件使用 `eventMatch(type, options)`。`operation.finished` 的 `eventMatch` 可以同时写 `tool` 与 `output`，两组条件保证落在同一 occurrence。精确计数写在 producer 的第二个参数 `{ count }`，不用 consumer 修饰符表达。
