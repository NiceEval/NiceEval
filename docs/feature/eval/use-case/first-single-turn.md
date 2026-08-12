# 单轮：一问一答就断言

## 解决什么问题

最常见的 eval 是「发一句话，看 agent 答得对不对、做没做该做的事」。
它需要的全部 API 就是三个动作：`t.send` 驱动、`t.reply` 读取、断言写入。
这一篇是所有其它用例的地基。

## 全流程

1. 一个文件默认导出一个 `defineEval`，id 从路径推导，不手写：

   ```typescript
   // evals/weather/brooklyn.eval.ts → id: weather/brooklyn
   import { defineEval } from "niceeval";
   import { includes } from "niceeval/expect";

   export default defineEval({
     description: "布鲁克林天气查询",
     async test(t) {
       await t.send("布鲁克林今天天气怎么样?");

       t.succeeded();
       t.calledTool("get_weather", { input: { city: "Brooklyn" }, count: 1 });
       t.check(t.reply, includes("晴"));
     },
   });
   ```

2. `await t.send(input)` 把输入交给 agent，等这一轮稳定后返回不可变 Turn。
   之后 `t.reply` 是最后一条 assistant 消息，`t.events` 是到目前为止的强类型事件流（[读取结果](../library/context.md#读取结果)）。
   带本地文件的一轮用 `t.sendFile(path, text?)`，文件按扩展名推断 MIME、随本轮输入附上。

3. 断言分两类，写在你观察结果的地方：
   - **作用域断言**（`t.succeeded()`、`t.calledTool(...)`）：调用时直接登记 Boolean Assertion，进入 Attempt Verdict。
   - **值断言**（`t.check(value, match)`）：就地对一个具体值登记 Assertion，match 从 `niceeval/expect` 导入（`includes` / `equals` / `matches` / `satisfies` …，全表见[值断言](../../assertions/library/value-assertions.md)）。
      后续代码依赖这个值时 `await handle.orStop()`——不通过就停止当前 continuation。

4. 结构化输出用 turn 接收者就地断：

   ```typescript
   const turn = await t.send("查布鲁克林天气,返回 JSON。");
   turn.outputEquals({ city: "Brooklyn", unit: "F" });   // 或 turn.outputMatches(zodSchema)
   ```

## 边界

- `t.calledTool(...)` 挂在 `t` 上看的是**整个 attempt**；只想断某一轮，挂在那一轮的 turn 上（接收者决定作用域，见[多轮与并行会话](multi-turn-sessions.md)）。
- 「答得好不好」这类没有唯一正确答案的问题，`includes` 表达不了，改用[裁判评质量](judge-quality.md)。
- 没有对错、只想观测的指标（如工具调用次数），别写成默认 gate——降级写法见[过程与成本](process-and-cost.md)。

## 相关阅读

- [Context](../library/context.md) —— `send` / `reply` / `events` 的契约。
- [值断言](../../assertions/library/value-assertions.md) —— matcher 全表与 `t.check` 的形状。
- [作用域断言](../../assertions/library/scoped-assertions.md) —— 断言词汇全表。
