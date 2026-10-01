---
format: concord.document/v1
id: derive-callid-crossturn-overwrite
title: deriveRunFacts 跨轮 callId 覆盖(已修)
createdAt: 2026-07-24T12:53:11+08:00
createdAtSource:
  kind: first-recorded
  path: memory/derive-callid-crossturn-overwrite.md
  commit: 67bacc46e6afb2b23e4b66496dc51d137ed41ee6
kind: memory
memoryKind: problem
state: resolved
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: "# deriveRunFacts 跨轮 callId 覆盖(已修)"
    proof: []
    source:
      path: memory/derive-callid-crossturn-overwrite.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:8439b83abcbc3a5a318eec1196be3c36c435214fafdb013dddf93215f97dbd2e
---
# deriveRunFacts 跨轮 callId 覆盖(已修)

**现象**：续轮场景下 `t.calledTool` / `t.notCalledTool` 等 t 级(attempt 聚合)断言「只扫最后一轮」。真机复现于 db-gpt 记忆 eval：agent 第一轮读了 init 与 INDEX(事件 [21][57]),第二轮才给答复,`t.calledTool` 断言却 miss——执行是对的,分是冤的(该 11 分算成 9)。是续轮引入后才踩到的路径:单轮时不撞。

**根因**：`src/o11y/derive.ts` 的 `deriveRunFacts` 旧实现按 `callId` 存 `Map<string, ToolCall>`,`action.called` 无条件 `map.set(callId, …)`。而 adapter 常按轮各自编号 callId(OpenAI 兼容协议、transcript 归一都复用 `c1`/`c2`…),`t.*` 聚合读的是跨轮 `manager.allEvents`。于是第二轮的 `c1` 覆盖第一轮的 `c1`,折叠后 `toolCalls` 只剩每个 callId 的最后一次——前几轮的工具调用被抹掉。subagent 折叠同构同病。

**修法**（`src/o11y/derive.ts`）：折叠改成逐条按序进行——`toolCalls: ToolCall[]` + `openToolByCallId: Map<callId, index>` 只跟踪各 callId 当前敞口(还没配 result)的那条;`action.called` 追加一条新记录并更新 open 指针,`action.result` 回填 open 那条并关闭(`delete`)。同一 callId 在其 result 之后再次 called 就是新调用,起新记录不覆盖。这同时修好了单轮内 `called→result→called→result` 的顺序复用。subagent 同样处理。

契约同步:`docs/feature/adapters/architecture/events.md` 不变量 2 补明「callId 只需在一个 called→result 配对内稳定,不要求跨轮唯一」;覆盖登记在 `docs/engineering/testing/unit/reports.md`(o11y 数据派生一条);回归测试 `src/o11y/derive.test.ts`(fold 级)+ `src/context/context.test.ts`(`t.calledTool` 用户面)。

**适用场景**:任何按轮各自编号 callId 的 adapter + 续轮(多次 `t.send`)+ t 级工具/subagent 断言。相关 [[events-user-message-and-source-loc]]。
