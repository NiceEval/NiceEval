# Scoring —— 库用法

最常见的评分写法是：先驱动 Agent，再对回复、行为、产物和成本记录断言。

```ts
import { defineEval } from "niceeval";
import { includes, commandSucceeded } from "niceeval/expect";

export default defineEval({
  async test(t) {
    const turn = await t.send("修复测试失败");

    t.check(turn.message, includes("完成"));
    turn.calledTool("shell");

    const test = await t.sandbox.runCommand("pnpm", ["test"]);
    t.check(test, commandSucceeded());

    t.judge.autoevals.closedQA("修改是否聚焦问题?").atLeast(0.7);
    t.maxCost(0.5);
  },
});
```

## 按任务阅读

| 任务 | 页面 |
|---|---|
| 比较值、schema、字符串或命令结果 | [值断言](library/value-assertions.md) |
| 断言消息、工具、事件、状态和成本 | [作用域断言](library/scoped-assertions.md) |
| 用裁判模型评价开放式结果 | [LLM-as-judge](library/judge.md) |
| 编写自己的 matcher | [自定义断言](library/custom-assertions.md) |
| 每类断言与 Turn 在 show / view 里长什么样 | [断言与 Turn 的展示](library/display.md) |

`t`、session 与 turn 怎样取得，见 [Eval Context](../eval/library/context.md)；Sandbox 命令和文件怎样操作，见 [Sandbox 操作](../sandbox/library/operations.md)。
