# 回答审批并继续同一会话

## 用户目标

评估作者要让测试 Agent 停在部署审批处，确认请求内容，再批准并检查恢复结果。

## 起始状态

已有 Experiment `approval` 选择支持 HITL 的测试 Adapter，操作目标是隔离的测试系统。
该 Adapter 在部署前返回 waiting Turn 与 `input.requested`，请求的 `action` 是 `deploy`，选项是 `approve` 与 `deny`。
Adapter 按 request ID 处理 `input.responses`，并恢复同一会话。以下结果均为预期输出，未发起部署。

## 完整路径

1. 在 Eval 目录保存 `approve-deploy.ts`，先要求进入审批，再发送结构化回答。 {#author}

   ```ts
   import { defineEval } from "niceeval";
   import { equals } from "niceeval/expect";

   export default defineEval({
     description: "批准测试部署后恢复执行",
     async test(t) {
       const waiting = await t.send("部署到测试环境，执行前请先请求批准。");
       await t.check(waiting.status, equals("waiting"))
         .label("等待审批")
         .orStop();

       const request = t.requireInputRequest({
         action: "deploy",
         optionIds: ["approve", "deny"],
       });
       const resumed = await t.respond({ request, optionId: "approve" });
       resumed.succeeded().label("批准后完成");
     },
   });
   ```

   预期输出：首轮检查匹配，筛选得到唯一的部署请求；回答携带该请求身份，进入同一 Session 的下一轮。
   若首轮并未 waiting，停止后续审批操作。

2. 执行这个 Eval，观察从 waiting 到完成的路径。 {#run}

   ```sh
   niceeval exp approval approve-deploy
   ```

   预期输出：Agent 使用被批准的请求恢复，完成后返回 completed Turn，两个检查匹配，Attempt 为 `passed`。
   最近一轮没有匹配请求或存在多个匹配请求时，`requireInputRequest` 拒绝继续，不能随意挑一个审批。

## 结果

审批作为结构化请求与回答经过 Adapter，主会话的暂停现场被正确续接。
普通文本“批准”不能替代 `respond`，回答也不能按请求数组的位置关联。

## 相关契约

- [会话与 HITL](../library/sessions-and-hitl.md#返回待输入请求)：waiting、请求与按 ID 恢复。
- [Eval 驱动 API](../../eval/library/context.md#驱动-api)：请求筛选与结构化回答。
- [Assertion handle](../../assertions/library/README.md#handle-配置)：前提检查与 `.orStop()`。
- [Experiment CLI](../../experiments/cli/README.md#命令)：运行入口。
