# 过程与成本：断 agent 怎么做到的

结果对了不等于过程对了。作用域 producer 将工具调用、事件和状态变成 Fact；作者显式消费它们，决定是否影响 Attempt。

```typescript
import { toolMatch } from "niceeval/expect";

const ranExperiment = t.calledTool(toolMatch("shell"));
const readTwice = t.calledTool(toolMatch("file_read"), { count: 2 });
const avoidedRecordFiles = t.notCalledTool(toolMatch("raw_record_reader"));

t.check(ranExperiment, { label: "运行实验" });
t.check(readTwice, { label: "读取两次" });
t.check(avoidedRecordFiles, { label: "未直接读取记录" });
```

工具的名称、输入与状态在 `toolMatch` 中表达；确切次数是 `calledTool` 的 `{ count }`。需要验证相对顺序时，先创建多个 `toolMatch`，再把它们传给 `toolOrder` 并消费结果。

```typescript
const read = toolMatch("read_file");
const write = toolMatch("write_file");
t.check(turn.toolOrder([read, write]), { label: "先读后写" });
```

成本、token 和事件也遵循同一模式：producer 不改变 Verdict，只有相应 Fact use 才改变它。尚未决定是否计入的指标不要创建悬空 Fact；先确定 consumer，或直接不声明该检查。

## 证据不足

否定检查、次数和上限需要完整证据。若证据不足，Fact 为 `unavailable`，普通 `check` / `require` 消费将 Attempt 标为 `errored`。这不是 Agent 未达标，也没有可选或软消费绕过该状态。

## 相关阅读

- [作用域 Fact](../../assertions/library/scoped-assertions.md) —— producer 与接收者范围。
- [Verdict 与 Fact use](../../verdict/architecture.md) —— 终态折叠。
- [自定义 Match](../../assertions/library/custom-assertions.md) —— 复杂输入条件。
