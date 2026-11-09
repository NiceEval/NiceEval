# 连接保留会话历史的服务

## 用户目标

Adapter 作者要让 Eval 连续向已有聊天服务发送两条消息，并验证新建会话不会复用旧会话的 ID。

## 起始状态

项目已配置 NiceEval 的发现目录，`SUPPORT_BOT_URL` 指向测试服务。
服务响应提供可信的终态、稳定的 `sessionId`、输出、用量与完整事件；项目的 `src/support-protocol.ts` 提供 `toStreamEvents` 转换函数。
协议与转换函数已验证能够完整保留六类证据，因此下例逐项声明 complete。
服务按 session ID 保存历史，首轮不要求 ID。以下输出均为预期输出，未实际访问服务。

## 完整路径

1. 在 `support-bot.ts` 中连接服务，把会话 ID 随请求发送，再捕获服务返回的 ID。 {#connect}

   ```ts
   import {
     defineAgent,
     makeSendFailure,
   } from "niceeval/adapter";
   import { toStreamEvents } from "./src/support-protocol.ts";

   export default defineAgent({
     name: "support-bot",
     evidenceCoverage: {
       events: { status: "complete" },
       actions: { status: "complete" },
       messages: { status: "complete" },
       usage: { status: "complete" },
       status: { status: "complete" },
       data: { status: "complete" },
     },
     async send(input, ctx) {
       const response = await fetch(`${process.env.SUPPORT_BOT_URL}/chat`, {
         method: "POST",
         headers: { "content-type": "application/json" },
         body: JSON.stringify({
           message: input.text,
           sessionId: ctx.session.id,
         }),
         signal: ctx.signal,
       });
       const body = await response.json();
       if (!response.ok || !body.terminal) {
         throw makeSendFailure({
           acceptance: body.acceptance ?? "unknown",
           message: `Support bot ended without a terminal state (HTTP ${response.status})`,
           events: toStreamEvents(body),
         });
       }
       ctx.session.capture(body.sessionId);
       return {
         status: body.status,
         data: body.output,
         events: toStreamEvents(body),
         usage: body.usage,
       };
     },
   });
   ```

   预期输出：首次请求不带已知 session ID；服务返回的 ID 成为下一轮请求的 `sessionId`。
   URL 与服务协议留在此 Adapter 内。

2. 在 Eval 目录保存 `remember-color.ts`，先续接主会话，再发起独立会话。 {#converse}

   ```ts
   import { defineEval } from "niceeval";
   import { includes } from "niceeval/expect";

   export default defineEval({
     description: "服务在同一会话记住颜色",
     async test(t) {
       await t.send("请记住，我选择蓝色。");
       const recalled = await t.send("我刚才选择了什么颜色？");
       t.check(recalled.reply, includes("蓝色")).label("记住颜色");

       const other = t.newSession();
       const fresh = await other.send("你好。");
       fresh.succeeded().label("独立会话可用");
     },
   });
   ```

   预期输出：第二轮能使用服务保存的主会话历史。
   独立会话的首轮中，Adapter 读取的 `ctx.session.id` 为 `undefined`；它不会携带主会话 ID。

3. 在 Experiment 目录保存 `support.ts`，执行这条用户路径。 {#run}

   ```ts
   import { defineExperiment } from "niceeval";
   import supportBot from "../support-bot.ts";

   export default defineExperiment({ adapter: supportBot, attempts: 1 });
   ```

   ```sh
   niceeval exp support remember-color
   ```

   预期输出：服务正确记忆且独立会话正常完成时，两个检查均匹配，Attempt 为 `passed`。
   HTTP 失败或缺少可信终态时进入 `SendFailure` 执行错误路径，不能视为聊天任务的普通失败。

## 结果

Eval 通过同一套 `t.send` 驱动服务；Adapter 负责保存与传递服务自己的会话 ID。
独立 Session 从没有原生会话 ID 的状态开始。

## 相关契约

- [Direct Agent](../library/direct-agent.md)：请求、取消、终态与应用协议。
- [服务端保存历史](../library/sessions-and-hitl.md#服务端保存历史)：会话 ID 的存取。
- [证据完整性](../architecture/evidence.md)：手写映射的逐项声明。
- [Eval context](../../eval/library/context.md)：`send` 与独立 Session。
- [Experiment Library](../../experiments/library/README.md#选择-adapter) 与 [CLI](../../experiments/cli/README.md#命令)：选择 Adapter 并执行。
