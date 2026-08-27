---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# 多轮与并行会话：每轮各自断，跨轮显式评

多轮任务里“这一轮做对了吗”和“整段对话是否一致”是不同问题。
作用域 Fact 的接收者决定证据范围：Turn 只看这一轮，session 只看那条会话，根 `t` 看整个 Attempt 的聚合证据。

## 全流程

1. 将每一轮保存为局部变量，并立即对该 Turn 登记断言：

   ```typescript
   import { closedQA, includes, toolMatch } from "niceeval/expect";

   const draft = await t.send("帮我拟一封跟进邮件。");
   draft.succeeded().label("草稿发送成功");
   t.check(draft.message, includes("此致")).label("邮件落款");

   draft.check(
     { input: draft.input, output: draft.message },
     closedQA("语气是否专业？").atLeast(0.8),
   ).gate().label("草稿语气");
   ```

2. 跨 Turn 的质量问题由作者显式组装字符串材料，再以根级 `t.check` 登记。输入和输出都是作者选择、已经得到的字符串：

   ```typescript
   const first = await t.send("列出风险。");
   const second = await t.send("再给出回滚方案。");

   t.check(
     {
       input: [first.input, second.input].join("\n\n"),
       output: [first.message, second.message].join("\n\n"),
     },
     closedQA("两轮回答是否前后一致？").atLeast(0.8),
   ).gate().label("跨轮一致性");
   ```

3. 需要互不干扰的会话时使用 `t.newSession()`。session 仍可登记作用域 Assertion：

   ```typescript
   const other = t.newSession();
   await other.send("查旧金山天气");
   other.calledTool(toolMatch("get_weather")).label("分支查询");
   ```

## 边界

- Turn 的 `input` 与 `message` 都不可变；单轮质量检查显式把它们组成 `{ input, output }`。
- 质量检查不附着在 `t`、Turn 或 session 上。跨轮、跨 session 或文件判断都由作者显式给出 `{ input, output }`，再交给 `check`。
- `t.newSession()` 的事件仍会汇入根级 `t.*` 聚合 Assertion，但不改变主 session 的 `t.reply` / `t.events` 即时视图。
- Judge Match 由 `check` 登记，且 Judge evaluator 在同一 Attempt 内串行运行。

## 相关阅读

- [Judge](../../judge/library.md) —— 材料与 capability。
- [Assertions · 作用域](../../assertions/library/scoped-assertions.md) —— 接收者范围。
- [Context](../library/context.md) —— session 与 Turn 字段全集。
