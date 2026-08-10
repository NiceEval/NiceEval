# calledTool 匹配：名称、输入、状态与次数

`toolMatch` 描述一条工具调用的名称、可选输入 Match 与状态；`calledTool` 将它提升为当前接收者范围内的 Fact。

```typescript
import type { JsonValue } from "niceeval";
import { equals, toolMatch } from "niceeval/expect";

const weather = t.calledTool(toolMatch("get_weather", {
  input: equals<JsonValue>({ city: "Brooklyn" }),
}));
const oneDeploy = t.calledTool(toolMatch("deploy"), { count: 1 });
const approved = t.calledTool(toolMatch("send_email", { status: "completed" }));

t.check(weather, { label: "查询 Brooklyn 天气" });
t.check(oneDeploy, { label: "只部署一次" });
t.check(approved, { label: "邮件已发送" });
```

省略 `{ count }` 表示至少一条匹配调用；给出正整数表示恰好该数量。上限或谓词条件应作为自定义 Match 或专门的 Fact producer 表达，不通过 consumer 参数猜测语义。

负检查使用相同的 Match：

```typescript
const noRawRecordRead = t.notCalledTool(toolMatch("shell", {
  input: equals<JsonValue>({ command: "cat .niceeval/result.json" }),
}));
t.check(noRawRecordRead, { label: "不直接读取记录文件" });
```

工具输入的结构由 `matches`、`equals` 等 value Match 描述。若输入证据不完整，只有有决定性正证据的 Match 才能通过；不能证明不存在或精确次数的 Fact 会如实成为 `unavailable`。

## 相关阅读

- [作用域 Fact](../../assertions/library/scoped-assertions.md) —— 接收者与 coverage。
- [自定义 Match](../../assertions/library/custom-assertions.md) —— 自定义输入规则。
