# 检查输出并在前提失败时停止

## 用户目标

评估作者要先确认 Agent 完成任务，再检查输出；前提不满足时，不继续登记依赖它的内容检查。

## 起始状态

项目有选择 Agent Adapter 的 Experiment `support`，发现目录中可以添加 Eval。
服务可返回可信的 `completed`、`failed` 或 `waiting` Turn。以下结果均为预期输出，未实际发送消息。

## 完整路径

1. 在 Eval 目录保存 `answer-check.ts`，先登记状态检查，再等待同一检查的 `.orStop()`。 {#author}

   ```ts
   import { defineEval } from "niceeval";
   import { equals, includes } from "niceeval/expect";

   export default defineEval({
     description: "完成回答后说明下一步",
     async test(t) {
       const turn = await t.send("说明处理方案，并用“下一步”引出后续操作。");
       await t.check(turn.status, equals("completed"))
         .label("回答已完成")
         .orStop();

       t.check(turn.reply, includes("下一步"))
         .label("说明后续操作");
     },
   });
   ```

   预期输出：状态匹配后继续检查 `turn.reply`；这两个 `check` 各登记一条断言。
   `.label` 与 `.orStop` 配置或等待第一条断言，不额外登记检查。

2. 执行这条 Eval，按实际返回值观察检查结果。 {#run}

   ```sh
   niceeval exp support answer-check
   ```

   | 返回事实 | 预期输出 |
   |---|---|
   | completed，正文包含“下一步” | 两项匹配，Attempt 为 `passed`。 |
   | completed，正文不包含“下一步” | 内容检查不匹配，Attempt 为 `failed`。 |
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
