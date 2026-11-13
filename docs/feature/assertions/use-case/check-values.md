# 检查输出并在前提失败时停止

## 用户目标

评估作者要先确认 Agent 完成任务，再检查回复里有没有它实际建立的工单号；前提不满足时，不继续登记依赖它的内容检查。

## 起始状态

项目有选择 Agent Adapter 的 Experiment `support`，发现目录中可以添加 Eval。
服务可返回可信的 `completed`、`failed` 或 `waiting` Turn，并提供按订单查询工单的公开接口。以下结果均为预期输出，未实际发送消息。

## 完整路径

1. 在 Eval 目录保存 `answer-check.ts`，先登记状态检查，再等待同一检查的 `.orStop()`。 {#author}

   ```ts
   import { defineEval } from "niceeval";
   import { equals, includes } from "niceeval/expect";
   import { latestTicket } from "../src/support-client";

   export default defineEval({
     description: "处理卡住的退款并告知工单号",
     async test(t) {
       const turn = await t.send("订单 4821 的退款卡了三天，帮我处理一下。");
       await t.check(turn.status, equals("completed"))
         .label("回答已完成")
         .orStop();

       const ticket = await latestTicket({ order: "4821" });
       t.check(turn.reply, includes(ticket.id))
         .label("回复给出工单号");
     },
   });
   ```

   题面只说用户的问题。工单号从应用的公开接口读出，题面里没有它，照抄题面的回复拿不到这一项（[T-27](../../../taste.md#t-27)）。

   预期输出：状态匹配后继续检查 `turn.reply`；这两个 `check` 各登记一条断言。
   `.label` 与 `.orStop` 配置或等待第一条断言，不额外登记检查。

2. 执行这条 Eval，按实际返回值观察检查结果。 {#run}

   ```sh
   niceeval exp support answer-check
   ```

   | 返回事实 | 预期输出 |
   |---|---|
   | completed，正文包含工单号 | 两项匹配，Attempt 为 `passed`。 |
   | completed，正文不包含工单号 | 内容检查不匹配，Attempt 为 `failed`。 |
   | failed 或 waiting | 状态检查不匹配，Attempt 为 `failed`；不登记内容检查。 |
   | send 无法取得可信 Turn | 进入执行错误路径，不能伪造一个状态不匹配的 Turn。 |

## 结果

每项检查都在观察位置登记，后续检查只在前提成立后出现。
停止后没有执行的内容检查不会被补成一条失败的 Assertion。

## 相关契约

- [值检查](../library/value-assertions.md)：显式 subject、Match 与 refinement。
- [handle 配置](../library/README.md#handle-配置)：同一条检查的 `.label` 与 `.orStop()`。
- [Pass Eval](../library/README.md#两种-eval)：Boolean condition 与 Verdict。
- [Experiment CLI](../../experiments/cli/README.md#命令)：执行入口。
