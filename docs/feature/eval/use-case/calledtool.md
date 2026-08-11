# calledTool 匹配：名称、输入、状态与次数

`calledTool(name, options)` 在调用时直接登记 Boolean Assertion。`name` 是工具名，`options` 约束
同一次调用的输入、状态与次数。

```typescript
t.calledTool("get_weather", { input: { city: "Brooklyn" } });
t.calledTool("deploy", { count: 1 });
t.calledTool("send_email", { status: "completed" });
```

`input` 使用递归 JSON 匹配：对象部分匹配、数组逐项匹配，任意层可用 `RegExp` 或动态谓词。
省略 `{ count }` 表示至少一条匹配调用；给出正整数表示恰好该数量，`{ atLeast: n }` 表示至少 n 次。

```typescript
t.calledTool("shell", { input: { command: /cat .niceeval\/result\.json/ } });
```

若输入或状态证据不完整，Assertion 如实成为 `unavailable`，不会把缺失当成否定。`notCalledTool` 是
同族负断言：只有在证据完整时它才可信，证据不足同样是 `unavailable`。

## 相关阅读

- [Scoped assertions](../../assertions/library/scoped-assertions.md) —— 接收者与证据范围。
- [过程与成本](process-and-cost.md) —— 次数、顺序与负断言。
