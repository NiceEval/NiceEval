# Assertions —— scoped methods

scope 语义由 [Assertions](../README.md#scope-与-succeeded) 单独定义。本页只列出作者调用形状。

```ts
const turn = await t.send("查找配置并汇报。");

t.succeeded().label("所有已启动会话完成");
turn.succeeded().label("当前 Turn 完成");
turn.calledTool("search", { count: { atLeast: 1 } }).label("至少一次搜索");
```

每一次调用都直接登记 Boolean Assertion。receiver 决定 snapshot，不能通过随后发生的 Session 或 Turn
改写。`t` 读取已启动 Session 的 vector cut；Session 读取自己的前缀；Turn 读取不可变 Turn。

`calledTool(...)` 与 `loadedSkill(...)` 保存匹配 occurrence 的 normalized context。它包括 scope、
operation / event identity、input、status、output / error refs、coverage 与匹配 event refs。

未命中时也保留观察范围与候选 occurrence refs，不把 context 压成一个 boolean。完整字段见
[Evidence · Scoped occurrence context](../architecture/evidence.md#scoped-occurrence-context)。

Usage methods 返回 Usage Assertion handle，才提供 `.ifCovered()`：

```ts
turn.usage.maxTokens(4_000)
  .ifCovered()
  .label("token 使用量可读取");
```

普通 scoped Assertion 在 Pass Eval 默认投影为 Verdict condition。在 Score Eval 它默认只保存 evaluation；需要贡献
score 时调用 `.score(n)`。Boolean scoped handle 可 `await .orStop()`。
