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

   const request = "帮我拟一封跟进邮件。";
   const draft = await t.send(request);
   draft.succeeded().label("草稿发送成功");
   t.check(draft.message, includes("此致")).label("邮件落款");

   t.check({ request, draft: draft.message }, draftQuality.atLeast(0.8))
     .gate().label("草稿语气");
   ```

2. Judge 材料由作者选择。逐轮判断可以各登记一次；需要评价多轮关系时，传入带语义字段的会话片段：

   ```typescript
   const first = await t.send("列出风险。");
   const second = await t.send("再给出回滚方案。");

   t.check({ request: "列出风险", response: first.message }, riskList.atLeast(0.8)).gate();
   t.check({ risks: first.message, rollback: second.message }, rollbackQuality.atLeast(0.8)).gate();
   ```

3. 需要互不干扰的会话时使用 `t.newSession()`。session 仍可登记作用域 Assertion：

   ```typescript
   const other = t.newSession();
   await other.send("查旧金山天气");
   other.calledTool(toolMatch("get_weather")).label("分支查询");
   ```

## 边界

- Judge 材料在 Assertion 登记时快照。后续修改源对象不会改变已登记请求。
- 多轮材料使用命名对象表达各段内容的角色，不用 `JSON.stringify` 拼接成无结构文本。
- `t.newSession()` 的事件仍会汇入根级 `t.*` 聚合 Assertion，但不改变主 session 的 `t.reply` / `t.events` 即时视图。
- Judge Match 由 `check` 登记，且 Judge evaluator 在同一 Attempt 内串行运行。

## 相关阅读

- [Judge](../../judge/library.md) —— 材料与 capability。
- [Assertions · 作用域](../../assertions/library/scoped-assertions.md) —— 接收者范围。
- [Context](../library/context.md) —— session 与 Turn 字段全集。
