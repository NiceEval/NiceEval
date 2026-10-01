---
format: concord.document/v1
id: annotated-source-absorbs-send-annotations
title: annotated-source-absorbs-send-annotations
createdAt: 2026-07-15T17:06:26+08:00
createdAtSource:
  kind: first-recorded
  path: memory/annotated-source-absorbs-send-annotations.md
  commit: 8d032cad6e47365a1235967d0b048c940a10ac17
description: 设计裁决:AnnotatedEvalSource 收编 send 行的 turn 头行标注,推翻「events → 轮次是
  ExecutionTree 的地盘、不进此模型」
kind: memory
memoryKind: decision
state: captured
epoch: 0
promotions: []
history: []
---

**裁决**(2026-07-15):`--eval` 源码视图在 `t.send(...)` 调用行标注该轮 turn 头行事实(身份 / status / 墙钟),数据模型落在 `AnnotatedEvalSource`(`SendAnnotation` + 每行 `sends` 桶 + 纯函数 `deriveSendAnnotations`),契约见 docs/feature/reports/show.md「--eval」。

**曾选方案**:annotated-source.ts 头注曾明确写「indexTurns()(events → 轮次)是 ExecutionTree 的地盘,不在这个模型里」——即源码标注模型只管断言,轮次留给 --execution。

**否决理由**:t.send 是 eval 里最重的一步,源码页上它一片空白,读者没法从源码对上「这行代码对应哪一轮、这一轮成了没成」。轮次的**完整展开**(卡片、工具调用)仍归 ExecutionTree/--execution 不变;进模型的只是头行事实,作跨面指针(与 --timing / diff windows 同一套 s/t 标签)。边界:send 标注不设 unmapped 兜底桶(断言的 never-drop 不适用)——轮次全量面是 --execution,定位不到行的轮直接丢。

分轮配对规则与 --execution 同源:第 i 条用户消息配 eval.run 下第 i 个 turn 节点;user message 事件的 loc 给行号。
