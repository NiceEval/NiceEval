# 过程与成本：断 agent 怎么做到的

结果对了不等于过程对了。作用域 Assertion 直接登记 Boolean 检查；作者决定每一条是否影响判定或贡献分数。

```typescript
t.calledTool("shell").label("运行实验");
t.calledTool("file_read", { count: 2 }).label("读取两次");
t.notCalledTool("raw_record_reader").label("未直接读取记录");
```

工具的名称、输入与状态在 `calledTool` 的 options 中表达；确切次数用 `{ count }`。需要验证相对顺序时，把工具名按顺序传给 `toolOrder`：

```typescript
turn.toolOrder(["read_file", "write_file"]).label("先读后写");
```

成本、token 和事件遵循同一规则：调用即登记 Assertion，默认进入 Pass Verdict 或只保存 Score
evaluation。尚未决定是否计入的指标不要登记；先用 Boolean Assertion、`.score(n)` 或干脆不声明。

## 证据不足

否定检查、次数和上限需要完整证据。若证据不足，Assertion 为 `unavailable`；在 Pass Eval 它使 Attempt
为 `errored`，在 Score Eval 只有配置了 `.score()` 或 `.orStop()` 的项才使 grading 不可排名。
这不是 Agent 未达标，也没有软消费绕过该状态。

## 相关阅读

- [Scoped assertions](../../assertions/library/scoped-assertions.md) —— 接收者范围与停止。
- [calledTool 匹配](calledtool.md) —— 名称、输入、状态与次数。
- [Verdict 与 AssertionResult](../../verdict/architecture.md) —— 终态折叠。
