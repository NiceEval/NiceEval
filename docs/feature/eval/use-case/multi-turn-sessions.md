# 多轮与并行会话：每轮各自断，跨轮显式评

多轮任务里“这一轮做对了吗”和“整段对话是否一致”是不同问题。
作用域 Fact 的接收者决定证据范围：Turn 只看这一轮，session 只看那条会话，根 `t` 看整个 Attempt 的聚合证据。

## 全流程

1. 将每一轮保存为局部变量，并立即消费该 Turn 的 Fact：

   ```typescript
   const draft = await t.send("帮我拟一封跟进邮件。");
   t.check(draft.succeeded(), { label: "草稿发送成功" });
   t.check(draft.message, includes("此致"), { label: "邮件落款" });

   const professional = draft.judge.autoevals.closedQA("语气是否专业？");
   t.check(professional.atLeast(0.8), { label: "草稿语气" });
   ```

2. 跨 Turn 的质量问题在根级 `t.judge` 明确组装材料。输入和输出都是作者选择、已经得到的字符串：

   ```typescript
   const first = await t.send("列出风险。");
   const second = await t.send("再给出回滚方案。");

   const consistent = t.judge.autoevals.closedQA("两轮回答是否前后一致？", {
     input: ["列出风险。", "再给出回滚方案。"].join("\n\n"),
     output: [first.message, second.message].join("\n\n"),
   });
   t.check(consistent.atLeast(0.8), { label: "跨轮一致性" });
   ```

3. 需要互不干扰的会话时使用 `t.newSession()`。session 仍可生产作用域 Fact，但不提供 Judge namespace：

   ```typescript
   const other = t.newSession();
   await other.send("查旧金山天气");
   t.check(other.calledTool(toolMatch("get_weather")), { label: "分支查询" });
   ```

## 边界

- `turn.judge` 的材料在 Turn 创建时冻结，不受之后的会话变化影响。
- `session.judge` 不存在。跨轮、跨 session 或文件判断一律走根级 `t.judge`，并显式给出 `{ input, output }`。
- `t.newSession()` 的事件仍会汇入根级 `t.*` 聚合 Fact，但不改变主 session 的 `t.reply` / `t.events` 即时视图。
- Judge Fact 必须被消费，且 Judge evaluator 在同一 Attempt 内串行运行。

## 相关阅读

- [Judge](../../judge/library.md) —— 材料与 capability。
- [Assertions · 作用域 Fact](../../assertions/library/scoped-assertions.md) —— 接收者范围。
- [Context](../library/context.md) —— session 与 Turn 字段全集。
