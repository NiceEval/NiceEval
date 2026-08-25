---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# HITL 审批：agent 停在人工输入上

## 解决什么问题

带人工审批的 agent 正确行为是「停下来问」，而不是一口气做完。
要评这类流程，需要把「停在了正确的请求上」变成 gate，再代替人类回答、驱动下一轮。
三个 API 各管一段：`t.check(turn.status, equals("waiting"))` 断停下了，`requireInputRequest(filter)` 取出待答请求，`respond` / `respondAll` 替人回答。

## 全流程

1. 发出任务，断言 agent 干净地停在输入请求上。
   停在审批上的那笔工具调用状态是 `pending`——「停下了」和「停在正确的调用上」各一条断言：

   ```typescript
   import { equals, toolMatch } from "niceeval/expect";

   const draft = await t.send("先拟稿,发出前让我确认。");
   t.check(draft.status, equals("waiting"));
   draft.calledTool(toolMatch("send_email").exactly(1));
   ```

2. 用 `requireInputRequest` 要求**恰好一个**匹配的待处理请求。
   filter 各字段是 AND 关系：`prompt` 匹配向用户展示的提问文本，`action` 匹配动作名（审批类请求即被审批的工具名），`optionIds` 要求选项集合完全一致（字段全集见 [Context](../library/context.md#驱动-api)）：

   ```typescript
   const request = t.requireInputRequest({
     prompt: /是否发送/,
     optionIds: ["approve", "reject"],
   });
   ```

3. 回答并继续。
   `respond` 就是同一 session 的下一轮发送，返回的 Turn 照常断言：

   ```typescript
   await t.respond({ request, optionId: "approve" });
   t.calledTool(toolMatch("send_email"));
   ```

4. 拒绝分支同样值得一条 eval——被拒工具调用的状态是 `rejected`，不是 `failed`：

   ```typescript
   await t.respond({ request, optionId: "reject" });
   t.calledTool(toolMatch("send_email", { status: "rejected" }));
   t.notCalledTool(toolMatch("send_email", { status: "completed" }));
   ```

5. 同类请求一批并停、且都选同一个选项时，用 `respondAll(optionId)` 一次答完：

   ```typescript
   await t.send("把这批改动逐项提交审批。");
   t.requireInputRequest({ prompt: /审批/ });
   await t.respondAll("approve");
   t.succeeded();
   ```

## 边界

- `respond` 的 `optionId` 必须存在于 `request.options` 里，写错直接抛；自由文本回答用 `text` 字段，二选一。
- 多个请求同时待处理且要**分别**回答时，用对象形式 `respond({ request, ... })` 逐一指名——字符串形式无法消歧。
- `draft.succeeded()` 与 `t.check(draft.status, equals("waiting"))` 互斥：停着未回答的请求不会成功完成。
  测「全程无停顿」就不要中途 `respond`。
- agent 怎样把停点表达成输入请求是 adapter 的责任，见 [Adapter · Session 与 HITL](../../adapters/library/sessions-and-hitl.md)。

## 相关阅读

- [Context · 驱动 API](../library/context.md#驱动-api) —— `requireInputRequest` filter 的字段全集。
- [作用域断言](../../assertions/library/scoped-assertions.md) —— `calledTool` 与 `status: "rejected"` 的语义。
