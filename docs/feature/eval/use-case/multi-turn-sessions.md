# 多轮与并行会话：每轮各自断，整段一起评

## 解决什么问题

多轮任务里「这一轮做对了吗」和「整段对话表现如何」是两个不同的问题。
作用域断言的词汇只有一套，**挂在哪个接收者上决定看哪份数据**（[接收者模型](../architecture.md#接收者模型位置决定作用域)）：turn 只看这一轮，session 看这条会话，`t` 看整个 attempt。
分清接收者，就不需要手工拼接每轮回复。

## 全流程

1. 把每一轮的返回赋给局部变量，顺着断言：

   ```typescript
   // evals/draft-then-send.eval.ts
   import { defineEval } from "niceeval";
   import { includes } from "niceeval/expect";

   export default defineEval({
     description: "先拟稿,确认后再发送",
     async test(t) {
       const draft = await t.send("帮我拟一封跟进邮件。");
       draft.succeeded();                                  // 只看这一轮
       t.check(draft.message, includes("此致"));
       draft.judge.autoevals.closedQA("语气是否专业").atLeast(0.6);

       await t.send("好,发出去。");
       t.calledTool("send_email");                         // 整个 attempt 里发生过即可
     },
   });
   ```

2. 评「整段多轮对话」（典型：跨轮记忆、前后一致性）时，judge 挂在 `t.judge` 上——它默认评主 session 的完整对话；只评某一轮就挂 `turn.judge`：

   ```typescript
   const turn1 = await t.send("这张图里有什么?");
   const turn2 = await t.send("背景是什么颜色?");           // 纯文字追问,考跨轮记忆
   const turn3 = await t.send("中间那个形状是什么颜色的?");

   t.judge.autoevals.closedQA("助手是否始终基于第一轮的图片作答?").atLeast(0.7);
   turn3.judge.autoevals.closedQA("这一轮是否回答了形状颜色?").gate();
   ```

3. 需要互不干扰的并行对话线（例如验证两个用户各自的上下文不串），用 `t.newSession()`：

   ```typescript
   const other = t.newSession();
   await other.send("查旧金山天气");
   other.calledTool("get_weather", { input: { city: "San Francisco" } });   // 只看这条 session
   ```

新 session 有同一套驱动 API（`send` / `sendFile` / `respond` / `events`）和同一套作用域断言；`session.judge` 默认评这条 session 自己的对话。

## 边界

- turn 与 session 的断言在**写入时 Run**：session 断言之后再发生的轮次不会改变已写入断言的评估材料。
  要看「到最后为止的全部」，挂 `t`。
- `t.newSession()` 开的 session 事件**仍会汇入** `t.*` 的 attempt 级聚合断言；但不进入 `t.reply` / `t.events` 这类主 session 即时读取视图。
- Turn 不能继续驱动会话——下一轮仍从 `t` 或对应 session 调用 `send`。
- 评 diff、文件内容等非会话材料时，judge 用 `{ on }` 显式传值（见[裁判评质量](judge-quality.md)）。

## 相关阅读

- [Assertions · 作用域](../../assertions/architecture/scopes.md) —— 每条断言看哪一轮的完整规则。
- [Context](../library/context.md) —— session 与 turn 的字段全集。
- [Architecture](../architecture.md) —— 为什么作用域由接收者决定。
