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
   import { includes, toolMatch } from "niceeval/expect";

   const draft = await t.send("帮我拟一封跟进邮件。");
   draft.succeeded().label("草稿发送成功");
   t.check(draft.message, includes("此致")).label("邮件落款");

   draft.check(draftQualityCheck, judge.llm().atLeast(0.8))
     .gate().label("草稿语气");
   ```

2. V1 Judge Check 只绑定一个 Turn。跨 Turn 的确定性事实由作者先拆成逐轮检查；需要整段会话 View 的场景属于 Judge Material Roadmap：

   ```typescript
   const first = await t.send("列出风险。");
   const second = await t.send("再给出回滚方案。");

   first.check(firstQualityCheck, judge.llm().atLeast(0.8)).gate();
   second.check(secondQualityCheck, judge.llm().atLeast(0.8)).gate();
   ```

3. 需要互不干扰的会话时使用 `t.newSession()`。session 仍可登记作用域 Assertion：

   ```typescript
   const other = t.newSession();
   await other.send("查旧金山天气");
   other.calledTool(toolMatch("get_weather")).label("分支查询");
   ```

## 边界

- Turn 的 `material.input` 与 `material.reply` 是不可伪造的受管 View；单轮质量检查把它们绑定到 Recipe Slot。
- V1 不接受作者拼接的原始字符串材料，也不提供 Session Material View。
- `t.newSession()` 的事件仍会汇入根级 `t.*` 聚合 Assertion，但不改变主 session 的 `t.reply` / `t.events` 即时视图。
- Judge Match 由 `check` 登记，且 Judge evaluator 在同一 Attempt 内串行运行。

## 相关阅读

- [Judge](../../judge/library.md) —— 材料与 capability。
- [Assertions · 作用域](../../assertions/library/scoped-assertions.md) —— 接收者范围。
- [Context](../library/context.md) —— session 与 Turn 字段全集。
